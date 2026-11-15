/**
 * otpStore.ts — PostgreSQL-backed OTP store for vault access codes.
 *
 * C7 hardening: each flow declares an explicit purpose. One active OTP per
 * (owner, purpose) pair — flows can no longer invalidate each other.
 * Legacy rows (purpose IS NULL) remain verifiable via beneficiaryEmail only
 * for one TTL window after migration.
 *
 * P1-2 hardening:
 *   - Codes stored as SHA-256 hashes (never plaintext in DB)
 *   - Comparison uses crypto.timingSafeEqual (constant-time)
 *   - Stale/expired rows are purged on every new generation
 */

import crypto from 'crypto';
import { db, otpsTable } from '@workspace/db';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';

// P1-2 note: 15 minutes is the server-side truth. The client UI label of
// "48 hours" is outdated — update the string in legacyTransfer.ts / received-vault.tsx.
const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

export const OTP_PURPOSES = {
  beneficiaryTransfer: 'beneficiary-transfer',
  pinReset: 'pin-reset',
  recoveryVerify: 'recovery-verify',
} as const;

export type OtpPurpose = (typeof OTP_PURPOSES)[keyof typeof OTP_PURPOSES];

export interface OtpEntry {
  code: string;       // stored as SHA-256 hex (never plaintext)
  ownerEmail: string;
  beneficiaryEmail: string;
  purpose: OtpPurpose;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
}

/**
 * Hash a plaintext OTP for storage/comparison.
 * SHA-256 is sufficient here: OTPs are 6-digit (10^6 space) and short-lived,
 * so rainbow tables are useless. A per-row salt adds complexity with no real
 * security gain in a 15-min TTL window.
 */
function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/** Constant-time equality check for OTP comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

/** Generate a cryptographically random 6-digit OTP and persist its hash. */
export async function generateOtp(
  ownerEmail: string,
  beneficiaryEmail: string,
  purpose: OtpPurpose,
): Promise<string> {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const codeHash = hashOtp(code);
  const now = Date.now();
  const ownerKey = ownerEmail.toLowerCase();
  const beneficiaryKey = beneficiaryEmail.toLowerCase();

  // P1-2: purge any stale rows for this (owner, purpose) BEFORE inserting.
  // Covers: expired, used, orphaned from previous failed runs. Keeps the table
  // tight and removes attack surface from leftover valid-looking rows.
  await db
    .delete(otpsTable)
    .where(
      or(
        and(eq(otpsTable.ownerEmail, ownerKey), eq(otpsTable.purpose, purpose), lt(otpsTable.expiresAt, now)),
        and(eq(otpsTable.ownerEmail, ownerKey), eq(otpsTable.purpose, purpose), sql`${otpsTable.usedAt} IS NOT NULL`),
      ),
    );

  await db
    .insert(otpsTable)
    .values({
      ownerEmail: ownerKey,
      purpose,
      code: codeHash,
      beneficiaryEmail: beneficiaryKey,
      createdAt: now,
      expiresAt: now + OTP_TTL_MS,
      usedAt: null,
      attempts: 0,
      maxAttempts: OTP_MAX_ATTEMPTS,
      lastAttemptAt: null,
    })
    .onConflictDoUpdate({
      target: [otpsTable.ownerEmail, otpsTable.purpose],
      set: {
        code: codeHash,
        beneficiaryEmail: beneficiaryKey,
        createdAt: now,
        expiresAt: now + OTP_TTL_MS,
        usedAt: null,
        attempts: 0,
        maxAttempts: OTP_MAX_ATTEMPTS,
        lastAttemptAt: null,
      },
    });

  return code;
}

export type OtpVerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'expired'
        | 'already_used'
        | 'max_attempts'
        | 'wrong_code'
        | 'wrong_beneficiary'
        | 'wrong_purpose';
    };

/** Verify an OTP with atomic consumption, purpose binding and attempt limit. */
export async function verifyOtp(
  ownerEmail: string,
  beneficiaryEmail: string,
  code: string,
  purpose: OtpPurpose,
): Promise<OtpVerifyResult> {
  const ownerKey = ownerEmail.toLowerCase();
  const beneficiaryKey = beneficiaryEmail.toLowerCase();
  const normalizedCode = code.trim();
  const codeHash = hashOtp(normalizedCode);

  const rows = await db
    .select()
    .from(otpsTable)
    .where(and(eq(otpsTable.ownerEmail, ownerKey), or(eq(otpsTable.purpose, purpose), isNull(otpsTable.purpose))))
    .limit(1);

  const entry = rows[0];
  if (!entry) return { ok: false, reason: 'not_found' };

  if (entry.purpose !== null && entry.purpose !== purpose) {
    return { ok: false, reason: 'wrong_purpose' };
  }

  const now = Date.now();
  if (now > entry.expiresAt) return { ok: false, reason: 'expired' };
  if (entry.usedAt) return { ok: false, reason: 'already_used' };
  if (entry.attempts >= entry.maxAttempts) return { ok: false, reason: 'max_attempts' };
  if (entry.beneficiaryEmail !== beneficiaryKey) return { ok: false, reason: 'wrong_beneficiary' };

  // P1-2: constant-time comparison of the hashed codes.
  if (timingSafeEqual(entry.code, codeHash)) {
    const consumed = await db
      .update(otpsTable)
      .set({ usedAt: now, lastAttemptAt: now })
      .where(
        and(
          eq(otpsTable.ownerEmail, ownerKey),
          eq(otpsTable.purpose, purpose),
          eq(otpsTable.beneficiaryEmail, beneficiaryKey),
          eq(otpsTable.code, codeHash),
          sql`${otpsTable.usedAt} IS NULL`,
          gt(otpsTable.expiresAt, now),
          sql`${otpsTable.attempts} < ${otpsTable.maxAttempts}`,
        ),
      )
      .returning({ ownerEmail: otpsTable.ownerEmail });

    if (consumed.length > 0) return { ok: true };
  } else {
    const counted = await db
      .update(otpsTable)
      .set({
        attempts: sql`${otpsTable.attempts} + 1`,
        lastAttemptAt: now,
      })
      .where(
        and(
          eq(otpsTable.ownerEmail, ownerKey),
          eq(otpsTable.purpose, purpose),
          sql`${otpsTable.usedAt} IS NULL`,
          gt(otpsTable.expiresAt, now),
          sql`${otpsTable.attempts} < ${otpsTable.maxAttempts}`,
        ),
      )
      .returning({ attempts: otpsTable.attempts, maxAttempts: otpsTable.maxAttempts });

    if (counted.length > 0) {
      return counted[0].attempts >= counted[0].maxAttempts
        ? { ok: false, reason: 'max_attempts' }
        : { ok: false, reason: 'wrong_code' };
    }
  }

  const latest = await db
    .select()
    .from(otpsTable)
    .where(and(eq(otpsTable.ownerEmail, ownerKey), eq(otpsTable.purpose, purpose)))
    .limit(1);
  const current = latest[0];
  if (!current) return { ok: false, reason: 'not_found' };
  if (Date.now() > current.expiresAt) return { ok: false, reason: 'expired' };
  if (current.usedAt) return { ok: false, reason: 'already_used' };
  if (current.attempts >= current.maxAttempts) return { ok: false, reason: 'max_attempts' };

  return { ok: false, reason: 'wrong_code' };
}

/** Return remaining milliseconds for the active OTP of a purpose, or 0. */
export async function getOtpRemainingMs(ownerEmail: string, purpose: OtpPurpose): Promise<number> {
  const rows = await db
    .select()
    .from(otpsTable)
    .where(and(eq(otpsTable.ownerEmail, ownerEmail.toLowerCase()), eq(otpsTable.purpose, purpose)))
    .limit(1);

  const entry = rows[0];
  if (!entry || entry.usedAt) return 0;
  return Math.max(0, entry.expiresAt - Date.now());
}
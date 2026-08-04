/**
 * otpStore.ts — PostgreSQL-backed OTP store for vault access codes.
 *
 * Each sealed vault can have one active 6-digit OTP at a time.
 * Requesting a new OTP invalidates the previous one.
 * TTL: 15 minutes, with a maximum of five failed verification attempts.
 */

import crypto from 'crypto';
import { db, otpsTable } from '@workspace/db';
import { and, eq, gt, sql } from 'drizzle-orm';

const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

export interface OtpEntry {
  code: string;
  ownerEmail: string;
  beneficiaryEmail: string;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
}

/** Generate a cryptographically random 6-digit OTP and persist it. */
export async function generateOtp(ownerEmail: string, beneficiaryEmail: string): Promise<string> {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const now = Date.now();

  await db
    .insert(otpsTable)
    .values({
      ownerEmail: ownerEmail.toLowerCase(),
      code,
      beneficiaryEmail: beneficiaryEmail.toLowerCase(),
      createdAt: now,
      expiresAt: now + OTP_TTL_MS,
      usedAt: null,
      attempts: 0,
      maxAttempts: OTP_MAX_ATTEMPTS,
      lastAttemptAt: null,
    })
    .onConflictDoUpdate({
      target: otpsTable.ownerEmail,
      set: {
        code,
        beneficiaryEmail: beneficiaryEmail.toLowerCase(),
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
        | 'wrong_beneficiary';
    };

/** Verify an OTP with atomic consumption and a strict attempt limit. */
export async function verifyOtp(
  ownerEmail: string,
  beneficiaryEmail: string,
  code: string,
): Promise<OtpVerifyResult> {
  const rows = await db
    .select()
    .from(otpsTable)
    .where(eq(otpsTable.ownerEmail, ownerEmail.toLowerCase()))
    .limit(1);

  const entry = rows[0];
  if (!entry) return { ok: false, reason: 'not_found' };
  const now = Date.now();
  if (now > entry.expiresAt) return { ok: false, reason: 'expired' };
  if (entry.usedAt) return { ok: false, reason: 'already_used' };
  if (entry.attempts >= entry.maxAttempts) return { ok: false, reason: 'max_attempts' };
  if (entry.beneficiaryEmail !== beneficiaryEmail.toLowerCase())
    return { ok: false, reason: 'wrong_beneficiary' };

  const ownerKey = ownerEmail.toLowerCase();
  const beneficiaryKey = beneficiaryEmail.toLowerCase();
  const normalizedCode = code.trim();

  if (entry.code === normalizedCode) {
    const consumed = await db
      .update(otpsTable)
      .set({ usedAt: now, lastAttemptAt: now })
      .where(
        and(
          eq(otpsTable.ownerEmail, ownerKey),
          eq(otpsTable.beneficiaryEmail, beneficiaryKey),
          eq(otpsTable.code, normalizedCode),
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
          eq(otpsTable.beneficiaryEmail, beneficiaryKey),
          sql`${otpsTable.usedAt} IS NULL`,
          gt(otpsTable.expiresAt, now),
          sql`${otpsTable.attempts} < ${otpsTable.maxAttempts}`,
        ),
      )
      .returning({
        attempts: otpsTable.attempts,
        maxAttempts: otpsTable.maxAttempts,
      });

    if (counted.length > 0) {
      return counted[0].attempts >= counted[0].maxAttempts
        ? { ok: false, reason: 'max_attempts' }
        : { ok: false, reason: 'wrong_code' };
    }
  }

  // A concurrent request may have consumed or exhausted the code between reads.
  const latest = await db
    .select()
    .from(otpsTable)
    .where(eq(otpsTable.ownerEmail, ownerKey))
    .limit(1);
  const current = latest[0];
  if (!current) return { ok: false, reason: 'not_found' };
  if (Date.now() > current.expiresAt) return { ok: false, reason: 'expired' };
  if (current.usedAt) return { ok: false, reason: 'already_used' };
  if (current.attempts >= current.maxAttempts) return { ok: false, reason: 'max_attempts' };

  return { ok: false, reason: 'wrong_code' };
}

/** Return remaining milliseconds for the active OTP, or 0 if none/expired. */
export async function getOtpRemainingMs(ownerEmail: string): Promise<number> {
  const rows = await db
    .select()
    .from(otpsTable)
    .where(eq(otpsTable.ownerEmail, ownerEmail.toLowerCase()))
    .limit(1);

  const entry = rows[0];
  if (!entry || entry.usedAt) return 0;
  return Math.max(0, entry.expiresAt - Date.now());
}

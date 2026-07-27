/**
 * otpStore.ts — PostgreSQL-backed OTP store for vault access codes.
 *
 * Each sealed vault can have one active 6-digit OTP at a time.
 * Requesting a new OTP invalidates the previous one.
 * TTL: 48 hours.
 */

import crypto from 'crypto';
import { db, otpsTable } from '@workspace/db';
import { eq } from 'drizzle-orm';

const OTP_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

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
    })
    .onConflictDoUpdate({
      target: otpsTable.ownerEmail,
      set: {
        code,
        beneficiaryEmail: beneficiaryEmail.toLowerCase(),
        createdAt: now,
        expiresAt: now + OTP_TTL_MS,
        usedAt: null,
      },
    });

  return code;
}

export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'expired' | 'already_used' | 'wrong_code' | 'wrong_beneficiary' };

/** Verify an OTP. Marks it as used on success. */
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
  if (Date.now() > entry.expiresAt) return { ok: false, reason: 'expired' };
  if (entry.usedAt) return { ok: false, reason: 'already_used' };
  if (entry.beneficiaryEmail !== beneficiaryEmail.toLowerCase())
    return { ok: false, reason: 'wrong_beneficiary' };
  if (entry.code !== code.trim()) return { ok: false, reason: 'wrong_code' };

  await db
    .update(otpsTable)
    .set({ usedAt: Date.now() })
    .where(eq(otpsTable.ownerEmail, ownerEmail.toLowerCase()));

  return { ok: true };
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

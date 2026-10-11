/**
 * recoveryEmailStore.ts — PostgreSQL-backed store for PIN recovery emails.
 *
 * Each user can have ONE recovery email (separate from their Clerk account email).
 * The email is stored as a hash (not plaintext) for privacy and security.
 */

import crypto from 'crypto';
import { db, recoveryEmailsTable } from '@workspace/db';
import { eq } from 'drizzle-orm';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Hashes an email address with a random salt using PBKDF2.
 * This ensures that even if the DB is compromised, the recovery email remains private.
 */
function hashEmail(email: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const normalizedEmail = email.toLowerCase().trim();
  const hash = crypto
    .pbkdf2Sync(normalizedEmail, salt, 10000, 64, 'sha256')
    .toString('hex');
  return { hash, salt };
}

// ── Store / Update ───────────────────────────────────────────────────────────

export async function upsertRecoveryEmail(
  userId: string,
  email: string,
): Promise<{ success: boolean; error?: string }> {
  const { hash, salt } = hashEmail(email);
  const now = Date.now();

  try {
    await db
      .insert(recoveryEmailsTable)
      .values({
        userId,
        emailHash: hash,
        emailSalt: salt,
        verified: false,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: recoveryEmailsTable.userId,
        set: {
          emailHash: hash,
          emailSalt: salt,
          verified: false, // Reset verification status on change
          updatedAt: now,
        },
      });
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

// ── Verify (mark as confirmed after OTP) ─────────────────────────────────────

export async function markRecoveryEmailVerified(userId: string): Promise<boolean> {
  try {
    await db
      .update(recoveryEmailsTable)
      .set({ 
        verified: true, 
        updatedAt: Date.now() 
      })
      .where(eq(recoveryEmailsTable.userId, userId));
    return true;
  } catch {
    return false;
  }
}

// ── Lookup by user ───────────────────────────────────────────────────────────

export interface RecoveryEmailRecord {
  id?: number;
  userId: string;
  emailHash: string;
  emailSalt: string;
  verified: boolean;
  updatedAt: number;
  createdAt?: number;
}

export async function getRecoveryEmailByUser(userId: string): Promise<RecoveryEmailRecord | null> {
  try {
    const rows = await db
      .select({
        userId: recoveryEmailsTable.userId,
        emailHash: recoveryEmailsTable.emailHash,
        emailSalt: recoveryEmailsTable.emailSalt,
        verified: recoveryEmailsTable.verified,
        updatedAt: recoveryEmailsTable.updatedAt,
      })
      .from(recoveryEmailsTable)
      .where(eq(recoveryEmailsTable.userId, userId))
      .limit(1);

    return rows[0] || null;
  } catch {
    return null;
  }
}

// ← إضافة جديدة: تُرجع السجل الكامل (مع id) للـ logging في routes/recovery-email.ts
export async function getRecoveryEmailRecord(userId: string): Promise<RecoveryEmailRecord | null> {
  try {
    const rows = await db
      .select()
      .from(recoveryEmailsTable)
      .where(eq(recoveryEmailsTable.userId, userId))
      .limit(1);
    return rows[0] || null;
  } catch {
    return null;
  }
}

// ── Verify email match (by hashing input and comparing) ──────────────────────
// ✅ التعديل: شفطنا شرط !record.verified لأن التفعيل يصير بعد نجاح الرمز، مو قبله

export async function verifyRecoveryEmailMatch(
  userId: string,
  email: string,
): Promise<boolean> {
  const record = await getRecoveryEmailByUser(userId);
  if (!record) return false; // ← فقط نتحقق من وجود السجل، ليس من حالة التفعيل

  const normalizedEmail = email.toLowerCase().trim();
  const inputHash = crypto
    .pbkdf2Sync(normalizedEmail, record.emailSalt, 10000, 64, 'sha256')
    .toString('hex');

  return inputHash === record.emailHash;
}

// ── Delete (user removes recovery email) ─────────────────────────────────────

export async function deleteRecoveryEmail(userId: string): Promise<boolean> {
  try {
    await db
      .delete(recoveryEmailsTable)
      .where(eq(recoveryEmailsTable.userId, userId));
    return true;
  } catch {
    return false;
  }
}
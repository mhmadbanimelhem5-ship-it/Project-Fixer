/**
 * keyStore.ts — PostgreSQL-backed store for the key-management layer.
 *
 * All functions are async and talk directly to the DB via Drizzle ORM.
 * Data persists across server restarts (unlike the previous in-memory Maps).
 *
 * JsonWebKey is a DOM type not available in Node.js @types/node.
 * We use a structural alias so the server stays type-safe without the DOM lib.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JWK = Record<string, any>;

import { db, publicKeysTable, sealedVaultsTable, guardianPackagesTable, guardianVotesTable } from '@workspace/db';
import { eq, and } from 'drizzle-orm';

// ── Public keys ───────────────────────────────────────────────────────────────

export async function storePublicKey(email: string, jwk: JWK): Promise<void> {
  const key = email.toLowerCase();
  await db
    .insert(publicKeysTable)
    .values({ email: key, jwk, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: publicKeysTable.email,
      set: { jwk, updatedAt: Date.now() },
    });
}

export async function lookupPublicKey(email: string): Promise<JWK | undefined> {
  const rows = await db
    .select()
    .from(publicKeysTable)
    .where(eq(publicKeysTable.email, email.toLowerCase()))
    .limit(1);
  return rows[0]?.jwk as JWK | undefined;
}

// ── Sealed vault packages ─────────────────────────────────────────────────────

export interface GuardianPackage {
  email: string;
  encryptedShare: string;
}

export interface SealedVault {
  encryptedBlob: string;
  beneficiaryEmail: string;
  benefEncryptedKey?: string;
  guardianPackages: GuardianPackage[];
  threshold: number;
  sealedAt: number;
}

export async function storeSealedVault(ownerEmail: string, vault: SealedVault): Promise<void> {
  const key = ownerEmail.toLowerCase();

  await db
    .insert(sealedVaultsTable)
    .values({
      ownerEmail: key,
      beneficiaryEmail: vault.beneficiaryEmail.toLowerCase(),
      encryptedBlob: vault.encryptedBlob,
      benefEncryptedKey: vault.benefEncryptedKey ?? null,
      threshold: vault.threshold,
      sealedAt: vault.sealedAt,
    })
    .onConflictDoUpdate({
      target: sealedVaultsTable.ownerEmail,
      set: {
        beneficiaryEmail: vault.beneficiaryEmail.toLowerCase(),
        encryptedBlob: vault.encryptedBlob,
        benefEncryptedKey: vault.benefEncryptedKey ?? null,
        threshold: vault.threshold,
        sealedAt: vault.sealedAt,
      },
    });

  // Replace guardian packages atomically (delete + re-insert)
  await db.delete(guardianPackagesTable).where(eq(guardianPackagesTable.ownerEmail, key));
  if (vault.guardianPackages.length > 0) {
    await db.insert(guardianPackagesTable).values(
      vault.guardianPackages.map(g => ({
        ownerEmail: key,
        guardianEmail: g.email.toLowerCase(),
        encryptedShare: g.encryptedShare,
      })),
    );
  }
}

export async function lookupSealedVault(ownerEmail: string): Promise<SealedVault | undefined> {
  const key = ownerEmail.toLowerCase();

  const vaultRows = await db
    .select()
    .from(sealedVaultsTable)
    .where(eq(sealedVaultsTable.ownerEmail, key))
    .limit(1);

  if (!vaultRows[0]) return undefined;
  const v = vaultRows[0];

  const pkgRows = await db
    .select()
    .from(guardianPackagesTable)
    .where(eq(guardianPackagesTable.ownerEmail, key));

  return {
    encryptedBlob: v.encryptedBlob,
    beneficiaryEmail: v.beneficiaryEmail,
    benefEncryptedKey: v.benefEncryptedKey ?? undefined,
    threshold: v.threshold,
    sealedAt: v.sealedAt,
    guardianPackages: pkgRows.map(r => ({
      email: r.guardianEmail,
      encryptedShare: r.encryptedShare,
    })),
  };
}

// ── Guardian votes (submitted Shamir shares) ──────────────────────────────────

export async function submitGuardianShare(
  ownerEmail: string,
  guardianEmail: string,
  rawShareHex: string,
): Promise<void> {
  const oKey = ownerEmail.toLowerCase();
  const gKey = guardianEmail.toLowerCase();

  await db
    .insert(guardianVotesTable)
    .values({ ownerEmail: oKey, guardianEmail: gKey, rawShareHex })
    .onConflictDoUpdate({
      target: [guardianVotesTable.ownerEmail, guardianVotesTable.guardianEmail],
      set: { rawShareHex },
    });
}

export interface CollectedShares {
  rawShares: string[];
  threshold: number;
}

export async function getCollectedShares(ownerEmail: string): Promise<CollectedShares | null> {
  const vault = await lookupSealedVault(ownerEmail);
  if (!vault) return null;

  const votes = await db
    .select()
    .from(guardianVotesTable)
    .where(eq(guardianVotesTable.ownerEmail, ownerEmail.toLowerCase()));

  return {
    rawShares: votes.map(r => r.rawShareHex),
    threshold: vault.threshold,
  };
}

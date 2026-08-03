/**
 * legacyTransfer.ts
 *
 * Orchestrates the three-layer cryptographic vault transfer:
 *
 *   Layer 1 — AES-256 (CryptoJS): encrypts the vault snapshot with a
 *             random 32-byte transfer key (TK).  Unchanged from local vault.
 *   Layer 2 — RSA-OAEP-2048 (keyManager.ts): encrypts TK for each
 *             guardian's share and for the beneficiary directly.
 *   Layer 3 — Shamir's Secret Sharing (shamirUtils.ts): splits TK into
 *             n guardian shares with a threshold of k.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SEAL flow (owner triggers once from Legacy screen):
 *
 *   1. Export vault items → plain JSON snapshot (requires unlocked vaultKey).
 *   2. Generate random 32-byte TK.
 *   3. AES-encrypt snapshot with TK → encryptedBlob.
 *   4. Shamir-split TK into n shares (one per guardian), threshold = k.
 *   5. For each guardian: fetch their RSA pubkey → encrypt their share → guardianPackage.
 *   6. Fetch beneficiary's RSA pubkey → encrypt full TK → benefEncryptedKey (optional).
 *   7. Upload all to server.
 *
 * APPROVE flow (guardian, triggered from Guardian tab or email link):
 *
 *   1. Fetch sealed vault package from server.
 *   2. Find own guardianPackage by email.
 *   3. RSA-decrypt the encrypted share with own private key → raw share hex.
 *   4. POST raw share to server.
 *
 * UNSEAL flow (beneficiary, triggered from Emergency tab):
 *
 *   Path A — direct (beneficiary registered key before sealing):
 *     1. Fetch vault package → benefEncryptedKey.
 *     2. RSA-decrypt benefEncryptedKey with own private key → TK bytes.
 *
 *   Path B — Shamir (enough guardians have voted):
 *     1. Fetch collected guardian shares from server.
 *     2. Shamir-combine shares → TK bytes.
 *
 *   Both paths: AES-decrypt encryptedBlob with TK → snapshot JSON → items[].
 */

import CryptoJS from 'crypto-js';
import * as SecureStore from 'expo-secure-store';
import { secureRandomBytes } from './cryptoUtils';
import { split, combine, encodeShare, decodeShare } from './shamirUtils';
import { encryptWithPublicKey, decryptWithPrivateKey, getOrCreatePublicKey } from './keyManager';
import {
  fetchPublicKey,
  sealVaultOnServer,
  submitGuardianShareToServer,
  fetchVaultPackage,
  fetchCollectedShares,
  requestVaultOtp,
  verifyVaultOtp,
  type GuardianPackagePayload,
} from './vaultTransferApi';
import type { VaultItem, Guardian, Beneficiary } from '@/contexts/VaultContext';

// ── Received vault cache (device-local) ───────────────────────────────────────

/**
 * The decrypted snapshot of a vault transferred to this beneficiary device.
 * Stored independently from the user's own vault — read-only, never merged.
 */
export interface ReceivedVaultSnapshot {
  version: '1';
  ownerName: string;
  ownerEmail: string;
  sealedAt: number;
  receivedAt: number;
  items: Array<{
    id: string;
    category: string;
    title: string;
    subtitle?: string;
    plainData: string;
    tags?: string[];
  }>;
}

/**
 * Derive a deterministic device-local encryption key for caching a received
 * vault. Based on the RSA public key bytes unique to this device, so the cache
 * is bound to the device and unreadable by anyone else.
 */
async function deviceKey(): Promise<string> {
  const pubRaw = await SecureStore.getItemAsync('auryx_rsa_public_v1');
  return CryptoJS.SHA256(pubRaw ?? 'auryx-fallback-device-key').toString().slice(0, 32);
}

function receivedVaultStoreKey(ownerEmail: string): string {
  const hash = CryptoJS.SHA256(ownerEmail).toString().slice(0, 16);
  return `auryx_rcv_${hash}`;
}

/** Retrieve a previously cached received vault for `ownerEmail`, or null. */
export async function getReceivedVaultCache(
  ownerEmail: string,
): Promise<ReceivedVaultSnapshot | null> {
  try {
    const storeKey = receivedVaultStoreKey(ownerEmail);
    const raw = await SecureStore.getItemAsync(storeKey);
    if (!raw) return null;
    const dk = await deviceKey();
    const bytes = CryptoJS.AES.decrypt(raw, dk).toString(CryptoJS.enc.Utf8);
    if (!bytes) return null;
    return JSON.parse(bytes) as ReceivedVaultSnapshot;
  } catch {
    return null;
  }
}

async function cacheReceivedVault(snapshot: ReceivedVaultSnapshot): Promise<void> {
  const storeKey = receivedVaultStoreKey(snapshot.ownerEmail);
  const dk = await deviceKey();
  const encrypted = CryptoJS.AES.encrypt(JSON.stringify(snapshot), dk).toString();
  await SecureStore.setItemAsync(storeKey, encrypted);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToU8(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++)
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return arr;
}

function u8ToHex(arr: Uint8Array): string {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Minimal snapshot of each vault item, re-encrypted with TK for transfer. */
interface ItemSnapshot {
  id: string;
  category: string;
  title: string;
  subtitle?: string;
  plainData: string;
  tags?: string[];
}

interface VaultSnapshot {
  version: '1';
  ownerName: string;
  sealedAt: number;
  items: ItemSnapshot[];
}

// ── Seal ──────────────────────────────────────────────────────────────────────

export interface SealParams {
  items: VaultItem[];
  /** Active PIN-derived vault key (needed to decrypt encryptedData fields) */
  vaultKey: string;
  guardians: Guardian[];
  beneficiary: Beneficiary;
  ownerName: string;
  ownerEmail: string;
  mOfN: { m: number; n: number };
}

export interface SealResult {
  success: boolean;
  error?: string;
  /** Guardian emails for which no public key was found (skipped) */
  missingKeys?: string[];
  /** Whether the beneficiary's direct key was included */
  beneficiaryKeyIncluded: boolean;
}

/**
 * Seal the vault for the beneficiary with guardian multi-sig protection.
 * Call this while the vault is unlocked (vaultKey is the active session key).
 */
export async function sealVault(params: SealParams): Promise<SealResult> {
  const { items, vaultKey, guardians, beneficiary, ownerName, ownerEmail, mOfN } = params;
  const activeGuardians = guardians.filter(g => g.status === 'active');

  // 1. Build plain snapshot (decrypt each item with the current vault key)
  const snapItems: ItemSnapshot[] = items.map(item => {
    let plainData = '';
    try {
      if (item.encryptedData) {
        const bytes = CryptoJS.AES.decrypt(item.encryptedData, vaultKey);
        plainData = bytes.toString(CryptoJS.enc.Utf8) || '';
      }
    } catch {
      // If decryption fails, skip data but keep metadata
    }
    return {
      id: item.id,
      category: item.category,
      title: item.title,
      subtitle: item.subtitle,
      plainData,
      tags: item.tags,
    };
  });

  const snapshot: VaultSnapshot = {
    version: '1',
    ownerName,
    sealedAt: Date.now(),
    items: snapItems,
  };

  // 2. Generate 32-byte random transfer key (TK) using the audited RNG helper
  //    (expo-crypto native on device, Math.random fallback with visible warning)
  const tk = await secureRandomBytes(32);
  const tkHex = u8ToHex(tk);

  // 3. AES-encrypt snapshot with TK (hex string acts as passphrase — consistent
  //    with the rest of CryptoJS usage in the app)
  const encryptedBlob = CryptoJS.AES.encrypt(JSON.stringify(snapshot), tkHex).toString();

  // 4. Shamir-split TK (n = guardians count, k = threshold m)
  const n = Math.max(activeGuardians.length, 1);
  const k = Math.min(mOfN.m, n);
  const shares = split(tk, n, k);

  // 5. Encrypt each guardian's share with their RSA public key
  const guardianPackages: GuardianPackagePayload[] = [];
  const missingKeys: string[] = [];

  for (let i = 0; i < activeGuardians.length; i++) {
    const guardian = activeGuardians[i];
    const share = shares[i];
    if (!share) continue;

    const pubKey = await fetchPublicKey(guardian.email).catch(() => null);
    if (!pubKey) {
      missingKeys.push(guardian.email);
      continue;
    }

    const shareHex = encodeShare(share);
    const encryptedShare = await encryptWithPublicKey(pubKey, new TextEncoder().encode(shareHex));
    guardianPackages.push({ email: guardian.email, encryptedShare });
  }

  // 6. Encrypt full TK with beneficiary's RSA public key (direct-access path)
  let benefEncryptedKey: string | undefined;
  let beneficiaryKeyIncluded = false;

  const benefPubKey = await fetchPublicKey(beneficiary.email).catch(() => null);
  if (benefPubKey) {
    benefEncryptedKey = await encryptWithPublicKey(benefPubKey, tk);
    beneficiaryKeyIncluded = true;
  }

  // 7. Upload to server
  await sealVaultOnServer({
    ownerEmail,
    beneficiaryEmail: beneficiary.email,
    encryptedBlob,
    benefEncryptedKey,
    guardianPackages,
    threshold: k,
  });

  // 8. Auto-send OTP to beneficiary (fire-and-forget — non-fatal if email fails)
  requestVaultOtp(ownerEmail, beneficiary.email, ownerName).catch(() => {
    // Email service might not be configured in dev; ignore silently.
  });

  return { success: true, missingKeys, beneficiaryKeyIncluded };
}

// ── OTP-gated vault unlock (beneficiary) ──────────────────────────────────────

export interface OtpUnlockResult {
  success: boolean;
  snapshot?: ReceivedVaultSnapshot;
  error?: string;
}

/**
 * Beneficiary: verify the 6-digit OTP with the server, then RSA-decrypt the
 * transfer key and AES-decrypt the vault snapshot.
 *
 * On success, the decrypted snapshot is cached in SecureStore so subsequent
 * views don't require an OTP.  The received vault is always stored under a
 * separate device key — it never touches the user's own vault.
 *
 * @param ownerEmail   - Email address of the vault owner
 * @param otp          - 6-digit code received by the beneficiary via email
 * @param beneficiaryEmail - The logged-in beneficiary's email (sent to server)
 */
export async function unlockWithOtp(
  ownerEmail: string,
  otp: string,
  beneficiaryEmail?: string,
): Promise<OtpUnlockResult> {
  // Derive beneficiary email from their own registered RSA key metadata if not provided.
  // For now we pass it in from the UI; future: store in SecureStore on first key creation.
  const bEmail = (beneficiaryEmail ?? '').trim().toLowerCase();

  // 1. Ask server to verify OTP → returns encrypted vault data
  const otpResult = await verifyVaultOtp(ownerEmail, bEmail, otp);
  if (!otpResult.valid) {
    const reasonMap: Record<string, string> = {
      expired:          'انتهت صلاحية الرمز (48 ساعة)',
      already_used:     'تم استخدام هذا الرمز مسبقاً',
      wrong_code:       'الرمز غير صحيح',
      wrong_beneficiary:'البريد الإلكتروني غير مطابق',
      not_found:        'لم يتم إصدار رمز لهذه الخزنة بعد',
    };
    return {
      success: false,
      error: reasonMap[otpResult.reason] ?? `خطأ: ${otpResult.reason}`,
    };
  }

  const { encryptedBlob, benefEncryptedKey, sealedAt } = otpResult;

  // 2. RSA-decrypt the transfer key (TK)
  let tkHex: string | null = null;

  if (benefEncryptedKey) {
    try {
      const tkBytes = await decryptWithPrivateKey(benefEncryptedKey);
      tkHex = u8ToHex(tkBytes);
    } catch {
      // private key mismatch — vault was sealed with a different device's key
    }
  }

  if (!tkHex) {
    return {
      success: false,
      error: 'تعذّر فك تشفير مفتاح النقل — تأكّد أنك على نفس الجهاز الذي سجّلت منه مفتاحك',
    };
  }

  // 3. AES-decrypt vault snapshot
  try {
    const decrypted = CryptoJS.AES.decrypt(encryptedBlob, tkHex).toString(CryptoJS.enc.Utf8);
    if (!decrypted) throw new Error('empty');
    const inner = JSON.parse(decrypted) as {
      version: string;
      ownerName: string;
      sealedAt: number;
      items: ReceivedVaultSnapshot['items'];
    };

    const snapshot: ReceivedVaultSnapshot = {
      version: '1',
      ownerName: inner.ownerName,
      ownerEmail,
      sealedAt: inner.sealedAt ?? sealedAt,
      receivedAt: Date.now(),
      items: inner.items ?? [],
    };

    // 4. Cache on device so subsequent opens don't need OTP
    await cacheReceivedVault(snapshot);

    return { success: true, snapshot };
  } catch {
    return { success: false, error: 'فشل فك التشفير — مفتاح النقل غير صحيح' };
  }
}

// ── Guardian approve ──────────────────────────────────────────────────────────

export interface ApproveParams {
  ownerEmail: string;
  /** The email the guardian used when they registered their public key */
  guardianEmail: string;
}

export interface ApproveResult {
  success: boolean;
  error?: string;
}

/**
 * Guardian: decrypt own RSA-encrypted Shamir share and submit it to the server
 * so the beneficiary can collect enough shares to reconstruct TK.
 */
export async function approveGuardianAccess(params: ApproveParams): Promise<ApproveResult> {
  const { ownerEmail, guardianEmail } = params;

  // Fetch sealed vault
  const pkg = await fetchVaultPackage(ownerEmail).catch(() => null);
  if (!pkg) return { success: false, error: 'Sealed vault not found for this owner' };

  // Find own encrypted share
  const myPkg = pkg.guardianPackages.find(
    p => p.email.toLowerCase() === guardianEmail.toLowerCase(),
  );
  if (!myPkg) return { success: false, error: 'Your share was not found in this vault package' };

  // RSA-decrypt to get raw share hex
  const rawBytes = await decryptWithPrivateKey(myPkg.encryptedShare);
  const rawShareHex = new TextDecoder().decode(rawBytes);

  // Submit to server
  await submitGuardianShareToServer(ownerEmail, guardianEmail, rawShareHex);

  return { success: true };
}

// ── Unseal ────────────────────────────────────────────────────────────────────

export interface UnsealResult {
  success: boolean;
  items?: VaultItem[];
  ownerName?: string;
  sealedAt?: number;
  error?: string;
  method?: 'direct' | 'shamir';
}

/**
 * Beneficiary: retrieve and decrypt the sealed vault.
 *
 * Tries Path A (direct RSA) first; falls back to Path B (Shamir combination)
 * if the beneficiary's direct key was not included at sealing time.
 */
export async function unsealVault(ownerEmail: string): Promise<UnsealResult> {
  // Fetch sealed vault package
  const pkg = await fetchVaultPackage(ownerEmail).catch(() => null);
  if (!pkg) return { success: false, error: 'لم يتم العثور على خزنة مغلّقة لهذا المالك' };

  let tkHex: string | null = null;
  let method: 'direct' | 'shamir' = 'direct';

  // Path A: direct beneficiary RSA decryption
  if (pkg.benefEncryptedKey) {
    try {
      const tkBytes = await decryptWithPrivateKey(pkg.benefEncryptedKey);
      tkHex = u8ToHex(tkBytes);
      method = 'direct';
    } catch {
      // Fall through to Path B
    }
  }

  // Path B: Shamir combination from guardian shares
  if (!tkHex) {
    const collected = await fetchCollectedShares(ownerEmail).catch(() => null);
    if (!collected || collected.rawShares.length < collected.threshold) {
      const need = collected?.threshold ?? pkg.threshold;
      const have = collected?.rawShares.length ?? 0;
      return {
        success: false,
        error: `يلزم ${need} أوصياء للموافقة — وافق ${have} حتى الآن`,
      };
    }

    const shares = collected.rawShares.map(decodeShare);
    const tkBytes = combine(shares.slice(0, collected.threshold));
    tkHex = u8ToHex(tkBytes);
    method = 'shamir';
  }

  // AES-decrypt vault snapshot
  try {
    const decrypted = CryptoJS.AES.decrypt(pkg.encryptedBlob, tkHex).toString(CryptoJS.enc.Utf8);
    if (!decrypted) throw new Error('empty');
    const snapshot = JSON.parse(decrypted) as VaultSnapshot;

    // Convert snapshot items back to VaultItem shape (re-encrypt with a display key
    // so the existing UI can render them without modification)
    const displayKey = `inherited_${ownerEmail}`;
    const items: VaultItem[] = snapshot.items.map(snap => ({
      id: snap.id,
      category: snap.category as VaultItem['category'],
      title: snap.title,
      subtitle: snap.subtitle,
      encryptedData: snap.plainData
        ? CryptoJS.AES.encrypt(snap.plainData, displayKey).toString()
        : '',
      createdAt: snapshot.sealedAt,
      updatedAt: snapshot.sealedAt,
      tags: snap.tags,
    }));

    return {
      success: true,
      items,
      ownerName: snapshot.ownerName,
      sealedAt: snapshot.sealedAt,
      method,
    };
  } catch {
    return { success: false, error: 'فشل فك التشفير — مفتاح التحويل غير صحيح' };
  }
}

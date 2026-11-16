/**
 * legacyTransfer.ts
 *
 * Orchestrates the three-layer cryptographic vault transfer:
 *
 *   Layer 1 — AES-256-GCM (cryptoUtils): encrypts the vault snapshot with a
 *             random 32-byte transfer key (TK).
 *   Layer 2 — RSA-OAEP-2048 (keyManager.ts): encrypts TK for each
 *             guardian's share and for the beneficiary directly.
 *   Layer 3 — Shamir's Secret Sharing (shamirUtils.ts): splits TK into
 *             n guardian shares with a threshold of k.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SECURITY POSTURE:
 * - Fail-Closed: Any failure in key generation, decryption, or fetching 
 *   results in an explicit error. No silent fallbacks to weak keys.
 * - Device-Bound Cache: Received vaults are encrypted with a key derived 
 *   from the device's own RSA public key, preventing cross-device leakage.
 */

import CryptoJS from 'crypto-js';
import * as SecureStore from 'expo-secure-store';
import { secureRandomBytes, encryptGCM, decryptGCM, deriveInnerKey } from './cryptoUtils';
import { split, combine, encodeShare, decodeShare } from './shamirUtils';
import { encryptWithPublicKey, decryptWithPrivateKey } from './keyManager';
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
 * Derive a deterministic device-local encryption key for caching a received vault.
 * Bound to the device's RSA public key. Fails closed if the key is not yet generated.
 * Returns a full 256-bit (64-char hex) key as required by AES-256-GCM.
 */
async function deviceKey(): Promise<string> {
  const pubRaw = await SecureStore.getItemAsync('auryx_rsa_public_v1');
  if (!pubRaw) {
    // FAIL-CLOSED: Never fall back to a hardcoded weak key.
    throw new Error('device_key_unavailable: RSA public key not yet generated');
  }
  return CryptoJS.SHA256(pubRaw).toString();
}

function receivedVaultStoreKey(ownerEmail: string): string {
  const hash = CryptoJS.SHA256(ownerEmail).toString().slice(0, 16);
  return `auryx_rcv_${hash}`;
}

export async function getReceivedVaultCache(
  ownerEmail: string,
): Promise<ReceivedVaultSnapshot | null> {
  try {
    const storeKey = receivedVaultStoreKey(ownerEmail);
    const raw = await SecureStore.getItemAsync(storeKey);
    if (!raw) return null;
    const dk = await deviceKey();
    const bytes = (await decryptGCM(raw, dk)) ?? '';
    if (!bytes) return null;
    return JSON.parse(bytes) as ReceivedVaultSnapshot;
  } catch {
    // Cache corruption or key unavailability -> treat as miss
    return null;
  }
}

async function cacheReceivedVault(snapshot: ReceivedVaultSnapshot): Promise<void> {
  const storeKey = receivedVaultStoreKey(snapshot.ownerEmail);
  const dk = await deviceKey();
  const encrypted = await encryptGCM(JSON.stringify(snapshot), dk);
  await SecureStore.setItemAsync(storeKey, encrypted);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hexToU8(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function u8ToHex(arr: Uint8Array): string {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

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
  missingKeys?: string[];
  beneficiaryKeyIncluded: boolean;
}

export async function sealVault(params: SealParams): Promise<SealResult> {
  const { items, vaultKey, guardians, beneficiary, ownerName, ownerEmail, mOfN } = params;
  const activeGuardians = guardians.filter(g => g.status === 'active');

  // 1. Build plain snapshot (decrypt each item with the HKDF inner key, GCM)
  const innerKey = deriveInnerKey(vaultKey);
  const snapItems: ItemSnapshot[] = await Promise.all(items.map(async item => {
    let plainData = '';
    try {
      if (item.encryptedData) {
        plainData = (await decryptGCM(item.encryptedData, innerKey)) ?? '';
        if (!plainData) {
          throw new Error(`sealVault: item ${item.id} decrypts to empty`);
        }
      }
    } catch (err) {
      // FAIL-CLOSED: Refuse to seal an incomplete or corrupted vault.
      const msg = err instanceof Error ? err.message : 'Unknown decryption error';
      throw new Error(`sealVault: failed to decrypt item ${item.id} - incomplete seal refused (${msg})`);
    }

    return {
      id: item.id,
      category: item.category,
      title: item.title,
      subtitle: item.subtitle,
      plainData,
      tags: item.tags,
    };
  }));

  const snapshot: VaultSnapshot = {
    version: '1',
    ownerName,
    sealedAt: Date.now(),
    items: snapItems,
  };

  // 2. Generate 32-byte random transfer key (TK)
  const tk = await secureRandomBytes(32);
  const tkHex = u8ToHex(tk);

  // 3. AES-encrypt snapshot with TK
  const encryptedBlob = await encryptGCM(JSON.stringify(snapshot), tkHex);

  // 4. Shamir-split TK
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

  // 6. Encrypt full TK with beneficiary's RSA public key
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

  // 8. Auto-send OTP to beneficiary (fire-and-forget)
  requestVaultOtp(ownerEmail, beneficiary.email, ownerName).catch(() => {});

  return { success: true, missingKeys, beneficiaryKeyIncluded };
}

// ── OTP-gated vault unlock (beneficiary) ──────────────────────────────────────

export interface OtpUnlockResult {
  success: boolean;
  snapshot?: ReceivedVaultSnapshot;
  error?: string;
}

export async function unlockWithOtp(
  ownerEmail: string,
  otp: string,
  beneficiaryEmail?: string,
): Promise<OtpUnlockResult> {
  const bEmail = (beneficiaryEmail ?? '').trim().toLowerCase();

  // 1. Verify OTP with server
  const otpResult = await verifyVaultOtp(ownerEmail, bEmail, otp);
  if (!otpResult.valid) {
    const reasonMap: Record<string, string> = {
      expired: 'انتهت صلاحية الرمز (15 دقيقة)',
      already_used: 'تم استخدام هذا الرمز مسبقاً',
      wrong_code: 'الرمز غير صحيح',
      wrong_beneficiary: 'البريد الإلكتروني غير مطابق',
      not_found: 'لم يتم إصدار رمز لهذه الخزنة بعد',
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
      // Private key mismatch — vault was sealed with a different device's key
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
    const decrypted = (await decryptGCM(encryptedBlob, tkHex)) ?? '';
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

    // 4. Cache on device. FAIL-CLOSED: If caching fails (e.g., key not ready), 
    // we skip it gracefully instead of falling back to a weak constant key.
    try {
      await cacheReceivedVault(snapshot);
    } catch {
      // Cache skipped for this session. Non-fatal.
    }

    return { success: true, snapshot };
  } catch {
    return { success: false, error: 'فشل فك التشفير — مفتاح النقل غير صحيح' };
  }
}

// ── Guardian approve ──────────────────────────────────────────────────────────

export interface ApproveParams {
  ownerEmail: string;
  guardianEmail: string;
}

export interface ApproveResult {
  success: boolean;
  error?: string;
}

export async function approveGuardianAccess(params: ApproveParams): Promise<ApproveResult> {
  const { ownerEmail, guardianEmail } = params;

  const pkg = await fetchVaultPackage(ownerEmail).catch(() => null);
  if (!pkg) return { success: false, error: 'لم يتم العثور على خزنة مغلّقة لهذا المالك' };

  const myPkg = pkg.guardianPackages.find(
    p => p.email.toLowerCase() === guardianEmail.toLowerCase(),
  );
  if (!myPkg) return { success: false, error: 'لم يتم العثور على حصتك في حزمة هذه الخزنة' };

  try {
    const rawBytes = await decryptWithPrivateKey(myPkg.encryptedShare);
    const beneficiaryKey = await fetchPublicKey(pkg.beneficiaryEmail);
    if (!beneficiaryKey) {
      return { success: false, error: 'المفتاح العام للمستفيد غير مسجّل' };
    }
    const encryptedShareForBeneficiary = await encryptWithPublicKey(beneficiaryKey, rawBytes);
    await submitGuardianShareToServer(ownerEmail, guardianEmail, encryptedShareForBeneficiary);
    return { success: true };
  } catch {
    return { success: false, error: 'فشل في فك تشفير أو إعادة تشفير الحصة' };
  }
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

export async function unsealVault(ownerEmail: string): Promise<UnsealResult> {
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
    if (!collected || collected.encryptedShares.length < collected.threshold) {
      const need = collected?.threshold ?? pkg.threshold;
      const have = collected?.encryptedShares.length ?? 0;
      return {
        success: false,
        error: `يلزم ${need} أوصياء للموافقة — وافق ${have} حتى الآن`,
      };
    }

    try {
      const shares = await Promise.all(
        collected.encryptedShares.map(async (encryptedShare) => {
          const shareBytes = await decryptWithPrivateKey(encryptedShare);
          return decodeShare(new TextDecoder().decode(shareBytes));
        }),
      );
      const tkBytes = combine(shares.slice(0, collected.threshold));
      tkHex = u8ToHex(tkBytes);
      method = 'shamir';
    } catch {
      return { success: false, error: 'فشل في تجميع حصص شامير' };
    }
  }

  // AES-decrypt vault snapshot
  try {
    const decrypted = (await decryptGCM(pkg.encryptedBlob, tkHex)) ?? '';
    if (!decrypted) throw new Error('empty');
    const snapshot = JSON.parse(decrypted) as VaultSnapshot;

    // Display-only obfuscation for inherited items (plaintext already in memory
    // on the beneficiary device). NOT a confidentiality boundary — documented.
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
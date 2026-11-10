/**
 * vaultCrypto.ts — authenticated symmetric crypto for vault payloads (v2).
 * Encrypt-then-MAC: AES-256 (CryptoJS) + HMAC-SHA256, mirroring the proven
 * pattern already used by mediaStorage.encryptPayload, but versioned and
 * shared by: vault blob, item fields, transfer blobs, received-vault cache.
 *
 * CLEAN-SLATE POLICY (v8 gate): NO legacy/v1 read path exists here by design.
 * Pre-v2 local state is wiped at startup by secureWipe.wipeLegacyVaultState().
 */
import CryptoJS from 'crypto-js';

export interface AuthPayload { v: 2; ct: string; mac: string; }

export function encryptAuth(plaintext: string, keyHex: string): string {
  const ct = CryptoJS.AES.encrypt(plaintext, keyHex).toString();
  const mac = CryptoJS.HmacSHA256(ct, keyHex).toString();
  const payload: AuthPayload = { v: 2, ct, mac };
  return JSON.stringify(payload);
}

/**
 * Verify-then-decrypt. Throws:
 *   'corrupt'        — not a v2 envelope / malformed JSON
 *   'integrity'      — MAC mismatch (tampered blob or wrong key)
 *   'decrypt_failed' — MAC ok but AES yielded empty (should not happen)
 */
export function decryptAuth(stored: string, keyHex: string): string {
  let obj: AuthPayload;
  try {
    obj = JSON.parse(stored) as AuthPayload;
  } catch {
    throw new Error('corrupt');
  }
  if (!obj || obj.v !== 2 || typeof obj.ct !== 'string' || typeof obj.mac !== 'string') {
    throw new Error('corrupt');
  }
  const expected = CryptoJS.HmacSHA256(obj.ct, keyHex).toString();
  if (expected !== obj.mac) throw new Error('integrity');
  const pt = CryptoJS.AES.decrypt(obj.ct, keyHex).toString(CryptoJS.enc.Utf8);
  if (!pt) throw new Error('decrypt_failed');
  return pt;
}

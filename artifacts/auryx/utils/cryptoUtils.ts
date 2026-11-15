/**
 * cryptoUtils.ts — Auryx secure-random helpers + AES-256-GCM encryption
 *
 * All cryptographic randomness in the app should flow through these helpers
 * so there is exactly ONE place to audit, and exactly ONE fallback path.
 *
 * Layer 1 (primary):   expo-crypto.getRandomBytesAsync — native OS RNG
 *                       (/dev/urandom on Android, SecRandomCopyBytes on iOS)
 * There is intentionally no Math.random fallback. Cryptographic operations must
 * fail closed if the native OS random source is unavailable.
 *
 * AES-256-GCM (added for vault data encryption):
 *   Primary  : crypto.subtle (native, fast)
 *   Fallback : @noble/ciphers (pure JS, audited by Cure53, works everywhere)
 *   Format   : Base64( IV[12] + Ciphertext + AuthTag[16] )
 *   Security : Authenticated encryption — any tampering causes decrypt to fail.
 */

import * as ExpoCrypto from 'expo-crypto';
import { gcm } from '@noble/ciphers/aes.js';

// ─── primitive helpers ───────────────────────────────────────────────────────

/**
 * Returns `length` cryptographically-secure random bytes.
 * Throws if the native OS random source is unavailable.
 */
export async function secureRandomBytes(length = 16): Promise<Uint8Array> {
  try {
    return await ExpoCrypto.getRandomBytesAsync(length);
  } catch (e) {
    throw new Error(
      `Secure random generation is unavailable; refusing to use an insecure fallback: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

/**
 * Converts a Uint8Array to a lowercase hex string.
 * Matches the output format of CryptoJS.lib.WordArray.toString().
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── composite helpers ───────────────────────────────────────────────────────

/**
 * Returns a hex string of `byteCount` cryptographically-secure random bytes.
 *
 * @example
 * const salt = await secureRandomHex(16);  // 128-bit hex salt
 * const key  = await secureRandomHex(32);  // 256-bit hex key
 */
export async function secureRandomHex(byteCount: number): Promise<string> {
  return bytesToHex(await secureRandomBytes(byteCount));
}

// ─── AES-256-GCM helpers ─────────────────────────────────────────────────────

const GCM_IV_BYTES = 12;   // 96-bit nonce (NIST SP 800-38D recommendation)
const GCM_TAG_BYTES = 16;  // 128-bit authentication tag
const GCM_KEY_BYTES = 32;  // 256-bit key

/** Convert a hex string to Uint8Array. Throws on invalid input. */
function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) {
    throw new Error('hexToBytes: invalid hex string');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('hexToBytes: invalid hex character');
    out[i] = byte;
  }
  return out;
}

/**
 * Create a clean ArrayBuffer copy from a Uint8Array.
 * This avoids TypeScript's strict BufferSource/ArrayBufferLike incompatibilities
 * across different TS versions and ensures crypto.subtle receives a proper buffer.
 */
function toAB(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.length);
  new Uint8Array(ab).set(bytes);
  return ab;
}

/** Encode bytes to Base64 (chunked to avoid stack overflow on large data). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000; // 32 KB chunks
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Decode Base64 to bytes. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Resolve crypto.subtle across RN / web environments.
 * Returns null if unavailable (caller falls back to @noble/ciphers).
 */
function getSubtle(): SubtleCrypto | null {
  try {
    const gc = (globalThis as Record<string, unknown>)['crypto'] as { subtle?: SubtleCrypto } | undefined;
    if (gc?.subtle) return gc.subtle;
    if (typeof global !== 'undefined') {
      const g = (global as Record<string, unknown>)['crypto'] as { subtle?: SubtleCrypto } | undefined;
      if (g?.subtle) return g.subtle;
    }
    if (typeof window !== 'undefined') {
      const w = (window as unknown as Record<string, unknown>)['crypto'] as { subtle?: SubtleCrypto } | undefined;
      if (w?.subtle) return w.subtle;
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * Encrypt a UTF-8 string with AES-256-GCM.
 *
 * @param plaintext - The string to encrypt (e.g. JSON.stringify(vaultItems))
 * @param keyHex    - 64-char hex string (256-bit key), e.g. the vaultKey
 * @returns Base64 blob: IV[12] + Ciphertext + AuthTag[16]
 * @throws If the key is invalid or encryption fails (fail-closed: never store plaintext).
 */
export async function encryptGCM(plaintext: string, keyHex: string): Promise<string> {
  const keyBytes = hexToBytes(keyHex);
  if (keyBytes.length !== GCM_KEY_BYTES) {
    throw new Error(`encryptGCM: key must be ${GCM_KEY_BYTES} bytes (got ${keyBytes.length})`);
  }

  const iv = await secureRandomBytes(GCM_IV_BYTES);
  const dataBytes = new TextEncoder().encode(plaintext);
  let cipherWithTag: Uint8Array;

  const subtle = getSubtle();
  if (subtle) {
    try {
      const cryptoKey = await subtle.importKey(
        'raw', toAB(keyBytes), { name: 'AES-GCM' }, false, ['encrypt'],
      );
      const ct = await subtle.encrypt(
        { name: 'AES-GCM', iv: toAB(iv), tagLength: GCM_TAG_BYTES * 8 },
        cryptoKey, toAB(dataBytes),
      );
      cipherWithTag = new Uint8Array(ct);
    } catch {
      // Native path failed — fall back to audited pure-JS implementation
      cipherWithTag = gcm(keyBytes, iv).encrypt(dataBytes);
    }
  } else {
    cipherWithTag = gcm(keyBytes, iv).encrypt(dataBytes);
  }

  // Pack: IV + (Ciphertext || Tag)
  const packed = new Uint8Array(iv.length + cipherWithTag.length);
  packed.set(iv, 0);
  packed.set(cipherWithTag, iv.length);
  return bytesToBase64(packed);
}

/**
 * Decrypt an AES-256-GCM blob produced by encryptGCM.
 *
 * FAIL-CLOSED: Returns null on ANY failure (wrong key, tampered data, corrupt
 * blob, tag mismatch). Never returns partial or unauthenticated plaintext.
 *
 * @param blob   - Base64 blob from encryptGCM
 * @param keyHex - 64-char hex string (256-bit key)
 * @returns The original UTF-8 string, or null if decryption/authentication fails.
 */
export async function decryptGCM(blob: string, keyHex: string): Promise<string | null> {
  try {
    const keyBytes = hexToBytes(keyHex);
    if (keyBytes.length !== GCM_KEY_BYTES) return null;

    const packed = base64ToBytes(blob);
    // Minimum size: IV(12) + Tag(16) = 28 bytes (empty plaintext)
    if (packed.length < GCM_IV_BYTES + GCM_TAG_BYTES) return null;

    const iv = packed.slice(0, GCM_IV_BYTES);
    const cipherWithTag = packed.slice(GCM_IV_BYTES);

    const subtle = getSubtle();
    if (subtle) {
      try {
        const cryptoKey = await subtle.importKey(
          'raw', toAB(keyBytes), { name: 'AES-GCM' }, false, ['decrypt'],
        );
        const pt = await subtle.decrypt(
          { name: 'AES-GCM', iv: toAB(iv), tagLength: GCM_TAG_BYTES * 8 },
          cryptoKey, toAB(cipherWithTag),
        );
        return new TextDecoder().decode(pt);
      } catch {
        // Native path failed — try pure-JS fallback (also validates the tag)
        try {
          const pt = gcm(keyBytes, iv).decrypt(cipherWithTag);
          return new TextDecoder().decode(pt);
        } catch {
          return null; // Both paths failed → tampered or wrong key
        }
      }
    }

    const pt = gcm(keyBytes, iv).decrypt(cipherWithTag);
    return new TextDecoder().decode(pt);
  } catch {
    return null; // Any parsing/decoding error → fail closed
  }
}
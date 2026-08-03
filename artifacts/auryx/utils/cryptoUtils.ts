/**
 * cryptoUtils.ts — Auryx secure-random helpers
 *
 * All cryptographic randomness in the app should flow through these helpers
 * so there is exactly ONE place to audit, and exactly ONE fallback path.
 *
 * Layer 1 (primary):   expo-crypto.getRandomBytesAsync — native OS RNG
 *                       (/dev/urandom on Android, SecRandomCopyBytes on iOS)
 * Layer 2 (fallback):  Math.random — NOT cryptographically secure; only used
 *                       when the native call throws (extremely rare in production).
 *                       A console.warn is emitted so the developer sees it.
 */

import * as ExpoCrypto from 'expo-crypto';

// ─── primitive helpers ───────────────────────────────────────────────────────

/**
 * Returns `length` cryptographically-secure random bytes.
 * Falls back to Math.random with a visible warning if the native call fails.
 */
export async function secureRandomBytes(length = 16): Promise<Uint8Array> {
  try {
    return await ExpoCrypto.getRandomBytesAsync(length);
  } catch (e) {
    console.warn('[auryx] expo-crypto getRandomBytesAsync failed — falling back to Math.random():', e);
    return new Uint8Array(
      Array.from({ length }, () => Math.floor(Math.random() * 256)),
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

/**
 * cryptoUtils.ts — Auryx secure-random helpers
 *
 * All cryptographic randomness in the app should flow through these helpers
 * so there is exactly ONE place to audit, and exactly ONE fallback path.
 *
 * Layer 1 (primary):   expo-crypto.getRandomBytesAsync — native OS RNG
 *                       (/dev/urandom on Android, SecRandomCopyBytes on iOS)
 * There is intentionally no Math.random fallback. Cryptographic operations must
 * fail closed if the native OS random source is unavailable.
 */

import * as ExpoCrypto from 'expo-crypto';

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

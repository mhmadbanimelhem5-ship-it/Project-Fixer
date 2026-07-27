/**
 * keyManager.ts
 *
 * RSA-OAEP-2048 / SHA-256 key pair management with automatic engine selection:
 *
 *   Primary  : crypto.subtle  — Hermes RN 0.74+, modern browsers (fast, native)
 *   Fallback : node-forge     — pure JS, no native modules (slower but universal)
 *
 * Engine is selected at call time via isSubtleAvailable().  Both paths produce
 * identical JWK-format keys that are interchangeable for encrypt/decrypt.
 *
 * Storage strategy — tries SecureStore first, falls back to module-level memory:
 *   SecureStore  → survives app restarts (native) / page reloads (web localStorage)
 *   Memory store → survives only the current session
 *
 * Android / Hermes compatibility:
 *   • RN 0.74+ Hermes: crypto.subtle available at globalThis.crypto.subtle ✓
 *   • Older Hermes / JSC / custom ROMs: automatic fallback to node-forge ✓
 *   • Web (Expo web): available at window.crypto.subtle ✓
 *   • Never replace global.crypto wholesale — polyfill.ts only patches
 *     getRandomValues and must not remove .subtle.
 *
 * Progress reporting:
 *   generateAndStoreKeyPair() and retryGeneration() accept an optional
 *   onProgress(pct: number, phase: string) callback that is called periodically
 *   while key generation is in progress. pct is 0–100; phase is a short Arabic
 *   description of the current step.  100 is reported exactly once, when the
 *   key is fully generated and persisted.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  isSubtleAvailable,
  generateKeyPairFallback,
  encryptWithPublicKeyFallback,
  decryptWithPrivateKeyFallback,
} from './cryptoFallback';

const PRIV_KEY_STORE = 'auryx_rsa_private_v1';
const PUB_KEY_STORE  = 'auryx_rsa_public_v1';

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: 'RSA-OAEP',
  modulusLength: 2048,
  publicExponent: new Uint8Array([0x01, 0x00, 0x01]), // 65537
  hash: 'SHA-256',
};

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED,
};

// ── Module-level memory fallback ──────────────────────────────────────────────
let memPubJwk:  JsonWebKey | null = null;
let memPrivJwk: JsonWebKey | null = null;

// ── Internal helpers ──────────────────────────────────────────────────────────

function u8ToB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...Array.from(bytes)));
}

function b64ToU8(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const ab = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(ab);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Resolve the SubtleCrypto interface across all runtime environments.
 *
 * Search order (most → least likely to work on each platform):
 *   1. globalThis.crypto.subtle  — Hermes RN 0.74+, modern browsers
 *   2. global.crypto.subtle      — React Native bridged environments
 *   3. window.crypto.subtle      — Expo web / older browsers
 *
 * Throws a descriptive error if nothing is found — callers should check
 * isSubtleAvailable() first and use the node-forge fallback if false.
 */
function subtle(): SubtleCrypto {
  // 1. globalThis — Hermes RN ≥ 0.74, standard browsers
  const gc = (globalThis as Record<string, unknown>)['crypto'] as
    | { subtle?: SubtleCrypto } | undefined;
  if (gc?.subtle) return gc.subtle;

  // 2. React Native's `global` (may differ from globalThis in bridged mode)
  if (typeof global !== 'undefined') {
    const rng = (global as Record<string, unknown>)['crypto'] as
      | { subtle?: SubtleCrypto } | undefined;
    if (rng?.subtle) return rng.subtle;
  }

  // 3. window.crypto.subtle — Expo web fallback
  if (typeof window !== 'undefined') {
    const wc = (window as unknown as Record<string, unknown>)['crypto'] as
      | { subtle?: SubtleCrypto } | undefined;
    if (wc?.subtle) return wc.subtle;
  }

  const env = Platform.OS === 'android'
    ? 'Android — جارٍ التبديل إلى المحرّك البديل (node-forge)'
    : Platform.OS === 'ios'
    ? 'iOS — تأكد من دعم الجهاز لـ WebCrypto'
    : 'الويب — يجب استخدام HTTPS حتى يعمل crypto.subtle في المتصفح';

  throw new Error(`crypto.subtle غير متاح على ${env}`);
}

// ── SecureStore helpers with memory fallback ───────────────────────────────────

async function storeKey(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value, SECURE_OPTS);
  } catch {
    // SecureStore unavailable (iframe sandbox, etc.) — keep in memory only
  }
}

async function loadKey(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a fresh RSA-OAEP-2048 key pair and persist it.
 * Returns the public key JWK (safe to upload to server).
 *
 * Engine selection (automatic):
 *   1. crypto.subtle (up to 3 attempts, 40 s each) — native Hermes/browser (fast)
 *   2. node-forge fallback — pure JS (slower, but guaranteed to work)
 *
 * onProgress(pct, phase): called periodically with 0–100 percentage and a
 *   short Arabic phase label. 100 is reported only after keys are persisted.
 *
 * Always generates a NEW key pair — never returns a cached one.
 * Use `getOrCreatePublicKey()` for the idempotent version.
 */
export async function generateAndStoreKeyPair(
  onProgress?: (pct: number, phase: string) => void,
): Promise<JsonWebKey> {
  const perfStart = Date.now();

  let pair: { pubJwk: JsonWebKey; privJwk: JsonWebKey } | null = null;

  // ── Primary path: native crypto.subtle (retry up to 3×) ───────────────────
  if (isSubtleAvailable()) {
    onProgress?.(3, 'محاولة المحرك الأصلي…');

    for (let attempt = 0; attempt < 3 && !pair; attempt++) {
      try {
        // Per-attempt timeout: 40 s (covers slow WebCrypto on some Android ROMs)
        const kp = await Promise.race([
          subtle().generateKey(RSA_PARAMS, true, ['encrypt', 'decrypt']),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('crypto.subtle timeout')), 40_000),
          ),
        ]);

        // Simulate smooth 3→98% progress during the fast native path
        onProgress?.(Math.min(50 + attempt * 20, 95), 'المحرك الأصلي يعمل…');

        pair = {
          pubJwk:  await subtle().exportKey('jwk', kp.publicKey),
          privJwk: await subtle().exportKey('jwk', kp.privateKey),
        };

        const ms = Date.now() - perfStart;
        console.info(`[Auryx] crypto.subtle RSA-2048 done in ${ms} ms (attempt ${attempt + 1})`);
      } catch (e) {
        console.warn(`[Auryx] crypto.subtle attempt ${attempt + 1} failed:`, String(e));
        if (attempt < 2) await new Promise<void>(r => setTimeout(r, 200));
      }
    }
  }

  // ── Fallback path: node-forge (pure JS, async, non-blocking) ──────────────
  if (!pair) {
    console.info('[Auryx] Switching to node-forge RSA fallback…');
    onProgress?.(0, 'جارٍ التحضير…');

    pair = await generateKeyPairFallback(onProgress);
  }

  const { pubJwk, privJwk } = pair;

  // Persist (best-effort SecureStore, always update memory cache)
  onProgress?.(99, 'جارٍ الحفظ الآمن…');
  await storeKey(PUB_KEY_STORE,  JSON.stringify(pubJwk));
  await storeKey(PRIV_KEY_STORE, JSON.stringify(privJwk));
  memPubJwk  = pubJwk;
  memPrivJwk = privJwk;

  onProgress?.(100, 'اكتمل التوليد ✓');
  return pubJwk;
}

/**
 * Return the stored public key JWK, generating a new key pair if none exists.
 * Idempotent — safe to call on every app launch.
 */
export async function getOrCreatePublicKey(
  onProgress?: (pct: number, phase: string) => void,
): Promise<JsonWebKey> {
  // Check memory cache first (fast path, avoids SecureStore round-trip)
  if (memPubJwk) return memPubJwk;

  // Try SecureStore
  const stored = await loadKey(PUB_KEY_STORE);
  if (stored) {
    const parsed = JSON.parse(stored) as JsonWebKey;
    memPubJwk = parsed;
    return parsed;
  }

  // Neither cache nor storage — generate a new pair
  return generateAndStoreKeyPair(onProgress);
}

/**
 * Clear the in-memory key cache so the next call to `getOrCreatePublicKey()`
 * or `generateAndStoreKeyPair()` cannot return a stale cached value.
 * Called at the start of a forced retry in `retryKeyGeneration()`.
 */
export function clearKeyCache(): void {
  memPubJwk  = null;
  memPrivJwk = null;
}

/**
 * Return the stored public key JWK, or null if no key pair exists yet.
 */
export async function getPublicKeyJwk(): Promise<JsonWebKey | null> {
  if (memPubJwk) return memPubJwk;
  const stored = await loadKey(PUB_KEY_STORE);
  if (!stored) return null;
  const parsed = JSON.parse(stored) as JsonWebKey;
  memPubJwk = parsed;
  return parsed;
}

/**
 * Return the stored PRIVATE key JWK, or null.
 * Used by the beneficiary to decrypt the transfer package.
 */
async function getPrivateKeyJwk(): Promise<JsonWebKey | null> {
  if (memPrivJwk) return memPrivJwk;
  const stored = await loadKey(PRIV_KEY_STORE);
  if (!stored) return null;
  const parsed = JSON.parse(stored) as JsonWebKey;
  memPrivJwk = parsed;
  return parsed;
}

/**
 * Encrypt `data` (max ≈ 190 bytes for RSA-OAEP-2048/SHA-256) with any
 * party's RSA public key JWK. Returns the ciphertext as base-64.
 *
 * Uses crypto.subtle if available, falls back to node-forge automatically.
 */
export async function encryptWithPublicKey(
  publicKeyJwk: JsonWebKey,
  data: Uint8Array,
): Promise<string> {
  if (!isSubtleAvailable()) {
    return encryptWithPublicKeyFallback(publicKeyJwk, data);
  }

  const key = await subtle().importKey(
    'jwk', publicKeyJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false, ['encrypt'],
  );
  const ab = data.buffer instanceof ArrayBuffer ? data.buffer : data.slice(0).buffer;
  const ct = await subtle().encrypt({ name: 'RSA-OAEP' }, key, ab);
  return u8ToB64(new Uint8Array(ct));
}

/**
 * Decrypt a base-64 ciphertext using the device's own RSA private key.
 * Returns the original plaintext bytes.
 *
 * Uses crypto.subtle if available, falls back to node-forge automatically.
 */
export async function decryptWithPrivateKey(ciphertextB64: string): Promise<Uint8Array> {
  const privJwk = await getPrivateKeyJwk();
  if (!privJwk) throw new Error('No RSA private key — call getOrCreatePublicKey() first');

  if (!isSubtleAvailable()) {
    return decryptWithPrivateKeyFallback(privJwk, ciphertextB64);
  }

  const key = await subtle().importKey(
    'jwk', privJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false, ['decrypt'],
  );
  const ctBytes = b64ToU8(ciphertextB64);
  const pt = await subtle().decrypt({ name: 'RSA-OAEP' }, key, ctBytes);
  return new Uint8Array(pt);
}

/**
 * True when a key pair is already stored (no generation needed).
 */
export async function hasKeyPair(): Promise<boolean> {
  if (memPubJwk) return true;
  const stored = await loadKey(PUB_KEY_STORE);
  return stored !== null;
}

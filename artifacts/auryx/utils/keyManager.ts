/**
 * keyManager.ts
 *
 * RSA-OAEP-2048 / SHA-256 key pair management using react-native-quick-crypto.
 * 
 * Engine: react-native-quick-crypto's subtle (Native C++ via OpenSSL)
 * - Supports RSA-OAEP generateKey, exportKey, importKey, encrypt, decrypt
 * - Returns CryptoKeyPair (same as Web Crypto API)
 * - Falls back to globalThis.crypto.subtle if available (Hermes 0.74+)
 */

import * as SecureStore from 'expo-secure-store';
import { subtle as quickSubtle } from 'react-native-quick-crypto';

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

function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const ab = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(ab);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Resolve SubtleCrypto: prefer native Hermes/browser, fallback to react-native-quick-crypto.
 */
function getSubtle(): SubtleCrypto {
  // 1. Try globalThis.crypto.subtle (Hermes 0.74+, browsers)
  const gc = (globalThis as Record<string, unknown>)['crypto'] as { subtle?: SubtleCrypto } | undefined;
  if (gc?.subtle) return gc.subtle;

  // 2. Fallback to react-native-quick-crypto's native subtle
  return quickSubtle as unknown as SubtleCrypto;
}

// ── SecureStore helpers with memory fallback ───────────────────────────────────

async function storeKey(key: string, value: string): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(key, value, SECURE_OPTS);
    return true;
  } catch {
    return false;
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

export async function generateAndStoreKeyPair(
  onProgress?: (pct: number, phase: string) => void,
): Promise<JsonWebKey> {
  const perfStart = Date.now();
  const subtle = getSubtle();

  onProgress?.(3, 'جارٍ توليد مفاتيح RSA-2048…');

  // Generate RSA-OAEP-2048 key pair (native C++ via react-native-quick-crypto)
  const kp = await subtle.generateKey(RSA_PARAMS, true, ['encrypt', 'decrypt']);

  onProgress?.(50, 'جارٍ تصدير المفاتيح…');

  // Export to JWK format (same as before)
  const pubJwk  = await subtle.exportKey('jwk', kp.publicKey);
  const privJwk = await subtle.exportKey('jwk', kp.privateKey);

  const ms = Date.now() - perfStart;
  console.info(`[Auryx] RSA-2048 generated in ${ms} ms`);

  // Persist
  onProgress?.(99, 'جارٍ الحفظ الآمن…');

  const pubStored  = await storeKey(PUB_KEY_STORE,  JSON.stringify(pubJwk));
  const privStored = await storeKey(PRIV_KEY_STORE, JSON.stringify(privJwk));
  memPubJwk  = pubJwk;
  memPrivJwk = privJwk;

  if (!pubStored || !privStored) {
    console.warn('[Auryx][keyManager] SecureStore write failed; keys kept in memory only');
  }

  onProgress?.(100, 'اكتمل التوليد ✓');
  return pubJwk;
}

export async function getOrCreatePublicKey(
  onProgress?: (pct: number, phase: string) => void,
): Promise<JsonWebKey> {
  if (memPubJwk) return memPubJwk;

  const stored = await loadKey(PUB_KEY_STORE);
  if (stored) {
    const parsed = JSON.parse(stored) as JsonWebKey;
    memPubJwk = parsed;
    return parsed;
  }

  return generateAndStoreKeyPair(onProgress);
}

export function clearKeyCache(): void {
  memPubJwk  = null;
  memPrivJwk = null;
}

export async function getPublicKeyJwk(): Promise<JsonWebKey | null> {
  if (memPubJwk) return memPubJwk;
  const stored = await loadKey(PUB_KEY_STORE);
  if (!stored) return null;
  const parsed = JSON.parse(stored) as JsonWebKey;
  memPubJwk = parsed;
  return parsed;
}

async function getPrivateKeyJwk(): Promise<JsonWebKey | null> {
  if (memPrivJwk) return memPrivJwk;
  const stored = await loadKey(PRIV_KEY_STORE);
  if (!stored) return null;
  const parsed = JSON.parse(stored) as JsonWebKey;
  memPrivJwk = parsed;
  return parsed;
}

export async function encryptWithPublicKey(
  publicKeyJwk: JsonWebKey,
  data: Uint8Array,
): Promise<string> {
  const subtle = getSubtle();
  const key = await subtle.importKey(
    'jwk', publicKeyJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false, ['encrypt'],
  );
  const ab = data.buffer instanceof ArrayBuffer ? data.buffer : data.slice(0).buffer;
  const ct = await subtle.encrypt({ name: 'RSA-OAEP' }, key, ab);
  return u8ToB64(new Uint8Array(ct));
}

export async function decryptWithPrivateKey(ciphertextB64: string): Promise<Uint8Array> {
  const privJwk = await getPrivateKeyJwk();
  if (!privJwk) throw new Error('No RSA private key — call getOrCreatePublicKey() first');

  const subtle = getSubtle();
  const key = await subtle.importKey(
    'jwk', privJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false, ['decrypt'],
  );
  const ctBytes = b64ToU8(ciphertextB64);
  const pt = await subtle.decrypt({ name: 'RSA-OAEP' }, key, ctBytes as BufferSource);
  return new Uint8Array(pt);
}

export async function hasKeyPair(): Promise<boolean> {
  if (memPubJwk && memPrivJwk) return true;

  const pub  = await loadKey(PUB_KEY_STORE);
  const priv = await loadKey(PRIV_KEY_STORE);

  if (pub && priv) return true;

  if (pub || priv) {
    console.warn('[Auryx][keyManager] incomplete RSA pair detected; treating as missing');
  }
  return false;
}
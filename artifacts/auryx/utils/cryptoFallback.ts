/**
 * cryptoFallback.ts
 *
 * RSA-OAEP-2048 / SHA-256 fallback implementation using node-forge (pure JS).
 * Activated automatically when the native Web Crypto API (crypto.subtle) is
 * unavailable — e.g. older Android ROMs, JSC engine, restricted environments.
 *
 * Algorithm compatibility with Web Crypto:
 *   Key type  : RSA-2048, public exponent 65537
 *   Scheme    : RSAES-OAEP
 *   Hash      : SHA-256 (label hash + MGF1 hash — matches Web Crypto default)
 *   Key format: RFC 7517 JWK — interchangeable with crypto.subtle.importKey()
 *
 * All exported functions mirror the primary crypto.subtle-based paths in
 * keyManager.ts so callers need no extra branching beyond the initial
 * isSubtleAvailable() check.
 */

import forge from 'node-forge';

// ─── Runtime availability check ───────────────────────────────────────────────

/**
 * Returns true when the native SubtleCrypto API is accessible.
 * Checks all known host locations (globalThis → global → window).
 */
export function isSubtleAvailable(): boolean {
  try {
    const tryGet = (obj: unknown): boolean => {
      const c = (obj as Record<string, unknown> | undefined)?.['crypto'];
      return !!(c as Record<string, unknown> | undefined)?.['subtle'];
    };
    if (tryGet(globalThis)) return true;
    if (typeof global !== 'undefined' && tryGet(global)) return true;
    if (typeof window !== 'undefined' && tryGet(window)) return true;
    return false;
  } catch {
    return false;
  }
}

// ─── BigInteger ↔ base64url helpers ───────────────────────────────────────────
// node-forge RSA keys expose parameters as jsbn.BigInteger objects.
// JWK encodes them as unsigned big-endian base64url with no leading zero bytes.

function bigIntToBase64Url(bi: forge.jsbn.BigInteger): string {
  let hex = bi.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  // Trim leading zero bytes (RFC 7518 §6.3 — no leading zeros in JWK integers)
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  return btoa(String.fromCharCode(...bytes.slice(start)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64UrlToBigInt(b64url: string): forge.jsbn.BigInteger {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '==='.slice((b64.length + 3) % 4);
  const bin = atob(padded);
  let hex = '';
  for (let i = 0; i < bin.length; i++) {
    hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (forge as any).jsbn.BigInteger(hex, 16) as forge.jsbn.BigInteger;
}

// ─── JWK ↔ forge key converters ───────────────────────────────────────────────

function jwkToForgePublicKey(jwk: JsonWebKey): forge.pki.rsa.PublicKey {
  return forge.pki.rsa.setPublicKey(
    base64UrlToBigInt(jwk.n!),
    base64UrlToBigInt(jwk.e!),
  );
}

function jwkToForgePrivateKey(jwk: JsonWebKey): forge.pki.rsa.PrivateKey {
  return forge.pki.rsa.setPrivateKey(
    base64UrlToBigInt(jwk.n!),
    base64UrlToBigInt(jwk.e!),
    base64UrlToBigInt(jwk.d!),
    base64UrlToBigInt(jwk.p!),
    base64UrlToBigInt(jwk.q!),
    base64UrlToBigInt(jwk.dp!),
    base64UrlToBigInt(jwk.dq!),
    base64UrlToBigInt(jwk.qi!),
  );
}

// ─── Progress simulation helpers ──────────────────────────────────────────────

/**
 * Simulated progress ticker for long-running operations with unknown duration.
 * Uses an exponential-decay curve: progress(t) = maxPct × (1 - e^(-t/tau))
 * that starts fast and slows as it approaches maxPct, never exceeding it until
 * the caller manually snaps it to 100 via the returned stop function.
 *
 * @param tau         time constant in ms (time to reach ~63% of maxPct)
 * @param maxPct      ceiling while running (snap to 100 when done)
 * @param onProgress  called every 800 ms with (pct, phaseLabel)
 * @param phaseLabel  human-readable label for the current phase
 * @returns           stop() — call when the operation completes
 */
function startProgressTicker(
  tau: number,
  maxPct: number,
  onProgress: (pct: number, phase: string) => void,
  phaseLabel: string,
): () => void {
  const startMs = Date.now();
  const interval = setInterval(() => {
    const elapsed = Date.now() - startMs;
    const pct = Math.round(maxPct * (1 - Math.exp(-elapsed / tau)));
    onProgress(Math.min(pct, maxPct), phaseLabel);
  }, 800);
  return () => clearInterval(interval);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate an RSA-OAEP-2048 key pair using node-forge (pure JS).
 * Returns both keys in JWK format, compatible with crypto.subtle.importKey().
 *
 * Progress reporting:
 *   0%  → initialising
 *   2%  → prime p generation begins (takes ~40–80% of total time)
 *   50% → prime q generation begins
 *   96% → computing key components (n, d, dp, dq, qi)
 *   100%→ done
 *
 * The progress values use an exponential-decay ticker so the bar always moves
 * smoothly instead of appearing stuck. It never reaches the phase ceiling until
 * the actual phase completes, so 100% is only shown once the key is ready.
 *
 * workers: -1 → node-forge uses its internal async prime testing via setTimeout,
 * so the React Native / Hermes JS event loop is NOT blocked between steps.
 * The UI stays responsive; generation just takes time on slow devices.
 */
export function generateKeyPairFallback(
  onProgress?: (pct: number, phase: string) => void,
): Promise<{ pubJwk: JsonWebKey; privJwk: JsonWebKey }> {
  return new Promise((resolve, reject) => {
    const perfStart = Date.now();

    // Report 0% immediately so the caller can initialise its bar
    onProgress?.(0, 'بدء التهيئة…');

    // 300 ms delay: lets React commit the overlay before forge saturates the
    // JS event loop (same reason as before, still needed on some ROMs).
    setTimeout(() => {
      onProgress?.(2, 'جارٍ إنشاء العامل الأول…');

      // Phase 1 ticker: 2 → 47%  tau=180 s  (covers slow low-end devices)
      // Phase 2 ticker: 48 → 93% tau=180 s  started when p is done
      // We use tau=180 000 ms — at 5 min elapsed → ~73%, at 10 min → ~94%
      // This keeps the bar moving even on very slow devices without ever
      // pre-emptively reaching the ceiling.
      const TAU = 180_000;

      // Phase 1 ticker (0 → 47%).  After TAU×0.5 ms, automatically switches to
      // Phase 2 ticker (48 → 93%).  Both phases run until the key gen callback
      // fires, at which point all timers are cleared.
      let stopCurrentTicker = startProgressTicker(TAU, 47, (pct, phase) => {
        onProgress?.(pct, phase);
      }, 'جارٍ إنشاء العامل الأول…');

      // One-shot timer: switch to phase 2 label halfway through expected duration
      const phase2Timer = setTimeout(() => {
        stopCurrentTicker();
        stopCurrentTicker = startProgressTicker(TAU, 93, (pct, phase) => {
          onProgress?.(Math.max(pct, 48), phase);
        }, 'جارٍ إنشاء العامل الثاني…');
      }, TAU * 0.5);

      // The actual key generation (async, yields to event loop between primality tests)
      forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001, workers: -1 }, (err, keypair) => {
        clearTimeout(phase2Timer);
        stopCurrentTicker();

        if (err) {
          onProgress?.(0, 'فشل التوليد');
          reject(new Error(`node-forge key generation failed: ${String(err)}`));
          return;
        }

        // Report phase 3: computing key components
        onProgress?.(96, 'جارٍ حساب مكونات المفتاح…');

        const pub  = keypair.publicKey;
        const priv = keypair.privateKey;

        const pubJwk: JsonWebKey = {
          kty: 'RSA',
          alg: 'RSA-OAEP-256',
          use: 'enc',
          key_ops: ['encrypt'],
          n: bigIntToBase64Url(pub.n),
          e: bigIntToBase64Url(pub.e),
        };

        const privJwk: JsonWebKey = {
          kty: 'RSA',
          alg: 'RSA-OAEP-256',
          use: 'enc',
          key_ops: ['decrypt'],
          n:  bigIntToBase64Url(priv.n),
          e:  bigIntToBase64Url(priv.e),
          d:  bigIntToBase64Url(priv.d),
          p:  bigIntToBase64Url(priv.p),
          q:  bigIntToBase64Url(priv.q),
          dp: bigIntToBase64Url(priv.dP),
          dq: bigIntToBase64Url(priv.dQ),
          qi: bigIntToBase64Url(priv.qInv),
        };

        const perfMs = Date.now() - perfStart;
        const mins = Math.floor(perfMs / 60000);
        const secs = Math.floor((perfMs % 60000) / 1000);
        console.info(`[Auryx] node-forge RSA-2048 completed in ${mins}m ${secs}s`);

        onProgress?.(100, 'اكتمل التوليد ✓');
        resolve({ pubJwk, privJwk });
      });

    }, 300);
  });
}

/**
 * Encrypt `data` with a public key JWK using RSA-OAEP-SHA-256 (node-forge).
 * Output is base64-encoded ciphertext — identical format to the crypto.subtle path.
 */
export function encryptWithPublicKeyFallback(pubJwk: JsonWebKey, data: Uint8Array): string {
  const key = jwkToForgePublicKey(pubJwk);
  const msg = Array.from(data).map(b => String.fromCharCode(b)).join('');
  const encrypted = key.encrypt(msg, 'RSA-OAEP', {
    md: forge.md.sha256.create(),
    mgf1: { md: forge.md.sha256.create() },
  });
  return btoa(encrypted);
}

/**
 * Decrypt a base64 ciphertext with a private key JWK using RSA-OAEP-SHA-256 (node-forge).
 * Returns the original plaintext bytes — identical contract to the crypto.subtle path.
 */
export function decryptWithPrivateKeyFallback(privJwk: JsonWebKey, ciphertextB64: string): Uint8Array {
  const key = jwkToForgePrivateKey(privJwk);
  const cipherBin = atob(ciphertextB64);
  const decrypted = key.decrypt(cipherBin, 'RSA-OAEP', {
    md: forge.md.sha256.create(),
    mgf1: { md: forge.md.sha256.create() },
  });
  return new Uint8Array(Array.from(decrypted).map(c => c.charCodeAt(0)));
}

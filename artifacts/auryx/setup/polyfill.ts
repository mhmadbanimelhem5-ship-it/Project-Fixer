/**
 * setup/polyfill.ts
 *
 * Executed BEFORE any component mounts. Ensures global.crypto.getRandomValues
 * is present using expo-crypto's native implementation.
 *
 * Rules:
 * 1. MERGE only — never replace the whole global.crypto object.
 *    Hermes (RN 0.74+) provides crypto.subtle which our PBKDF2 needs.
 *    Replacing would remove .subtle and crash PIN hashing.
 * 2. Wrapped in try/catch so the failure is visible without installing an
 *    insecure replacement.
 * 3. No-op if getRandomValues is already present (RN 0.76+ Hermes ships it).
 */
try {
  // Dynamic require avoids top-level import so Metro tree-shakes this safely
  // and any native init error is caught by the try/catch instead of crashing.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ExpoCrypto = require('expo-crypto') as typeof import('expo-crypto');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gc = global as any;

  if (!gc.crypto) {
    gc.crypto = {};
  }
  if (!gc.crypto.getRandomValues && ExpoCrypto.getRandomValues) {
    gc.crypto.getRandomValues = ExpoCrypto.getRandomValues;
  }
} catch (e) {
  // expo-crypto native init failed. Do not install Math.random here: callers
  // that require secure randomness must fail explicitly rather than weakening
  // key generation.
  // eslint-disable-next-line no-console
  console.error('[auryx] expo-crypto initialization failed; secure randomness is unavailable:', e);
}

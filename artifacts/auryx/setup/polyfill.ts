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
 * 2. Wrapped in try/catch — a native module crash here must not bring
 *    down the entire app (graceful degradation).
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
  // expo-crypto native init failed.
  // Install a Math.random-based getRandomValues so downstream code that calls
  // global.crypto.getRandomValues() never throws — it will just get lower-
  // quality randomness, which is acceptable for development / edge-case devices.
  // eslint-disable-next-line no-console
  console.warn('[auryx] polyfill: expo-crypto init failed — installing Math.random fallback for getRandomValues:', e);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gc = global as any;
  if (!gc.crypto) gc.crypto = {};
  if (!gc.crypto.getRandomValues) {
    gc.crypto.getRandomValues = function <T extends ArrayBufferView>(array: T): T {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
      return array;
    };
  }
}

import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import CryptoJS from 'crypto-js';
import { secureRandomHex } from '@/utils/cryptoUtils';

const PIN_HASH_KEY        = 'auryx_pin_hash';
const PIN_SALT_KEY        = 'auryx_pin_salt';
const ATTEMPTS_KEY        = 'auryx_attempts';
const LOCKOUT_KEY         = 'auryx_lockout_until';
const VAULT_KEY_KEY       = 'auryx_vault_key';
const DECOY_PIN_HASH_KEY  = 'auryx_decoy_pin_hash';
const DECOY_VAULT_KEY_KEY  = 'auryx_decoy_vault_key';
const BIOMETRICS_KEY      = 'auryx_biometrics_enabled';
const DATA_VERSION_KEY    = 'auryx_data_v';

// v7: migrate authentication metadata without deleting either vault key.
// Older PIN hashes may be incompatible, but the random vault keys must remain
// available so the encrypted vault is not orphaned during the migration.
const DATA_VERSION = '7';

export type LockType = 'pin' | 'password' | 'pattern';

interface AuthContextType {
  isLocked: boolean;
  isSetup: boolean;
  lockType: LockType;
  isDecoyMode: boolean;
  attempts: number;
  lockoutUntil: number | null;
  vaultKey: string | null;
  biometricsEnabled: boolean;
  biometricsAvailable: boolean;
  intruderDetected: boolean;
  setupPin: (pin: string) => Promise<void>;
  setupDecoyPin: (decoyPin: string) => Promise<void>;
  verifyPin: (pin: string) => Promise<boolean>;
  changePin: (currentPin: string, newPin: string) => Promise<boolean>;
  unlock: (pin: string) => Promise<boolean>;
  unlockWithBiometrics: () => Promise<boolean>;
  lock: () => void;
  getLockoutRemaining: () => number;
  canAttempt: () => boolean;
  wipeAll: () => Promise<void>;
  hasPin: () => Promise<boolean>;
  enableBiometrics: () => Promise<boolean>;
  disableBiometrics: () => Promise<void>;
  clearIntruderDetected: () => void;
}

const AuthContext = createContext<AuthContextType>({
  isLocked: true, isSetup: false, lockType: 'pin', isDecoyMode: false,
  attempts: 0, lockoutUntil: null, vaultKey: null,
  biometricsEnabled: false, biometricsAvailable: false, intruderDetected: false,
  setupPin: async () => {}, setupDecoyPin: async () => {},
  verifyPin: async () => false, changePin: async () => false,
  unlock: async () => false, unlockWithBiometrics: async () => false,
  lock: () => {}, getLockoutRemaining: () => 0, canAttempt: () => true,
  wipeAll: async () => {}, hasPin: async () => false,
  enableBiometrics: async () => false, disableBiometrics: async () => {},
  clearIntruderDetected: () => {},
});

/* ─── secure storage helpers ─── */
async function secureGet(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return localStorage.getItem(key);
    return await SecureStore.getItemAsync(key);
  } catch { return null; }
}
async function secureSet(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') { localStorage.setItem(key, value); return; }
    await SecureStore.setItemAsync(key, value);
  } catch {}
}
async function secureDelete(key: string): Promise<void> {
  try {
    if (Platform.OS === 'web') { localStorage.removeItem(key); return; }
    await SecureStore.deleteItemAsync(key);
  } catch {}
}
// Variant that throws on failure — used for critical vault-creation writes so
// callers can surface "Storage unavailable" instead of silently losing the PIN.
async function secureSetOrThrow(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') { localStorage.setItem(key, value); return; }
  await SecureStore.setItemAsync(key, value);
}

const ALL_AUTH_KEYS = [
  PIN_HASH_KEY, PIN_SALT_KEY, ATTEMPTS_KEY, LOCKOUT_KEY,
  VAULT_KEY_KEY, DECOY_PIN_HASH_KEY, DECOY_VAULT_KEY_KEY, BIOMETRICS_KEY,
];

// PBKDF2-HMAC-SHA256, 8000 iterations.
//
// Primary path: Web Crypto API (async, native, non-blocking).
//   Available in React Native 0.74+ (Hermes). Runs off the JS thread so the
//   loading spinner stays responsive during the ~200 ms derive operation.
//
// Fallback: CryptoJS with explicit SHA-256 PRF + 50 ms yield so the loading
//   UI renders BEFORE the synchronous CryptoJS hash blocks the thread.
//
// Both paths produce identical output for ASCII inputs (hex salt + digit PIN)
// because UTF-8 and Latin-1 encode ASCII identically.
async function hashPin(pin: string, salt: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subtle = (global as any).crypto?.subtle as {
    importKey(f: string, k: Uint8Array, a: string, e: boolean, u: string[]): Promise<unknown>;
    deriveBits(a: { name: string; salt: Uint8Array; iterations: number; hash: string }, k: unknown, b: number): Promise<ArrayBuffer>;
  } | undefined;

  if (subtle) {
    try {
      // Guard with a 3 s timeout: if the native crypto module is in a bad
      // state (e.g. wrong version at install time) these Promises can hang
      // forever, causing the "Creating Vault…" screen to never resolve.
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('crypto.subtle timeout')), 3000),
      );
      const enc = new TextEncoder();
      const key = await Promise.race([
        subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']),
        timeout,
      ]);
      const buf = await Promise.race([
        subtle.deriveBits(
          { name: 'PBKDF2', salt: enc.encode(salt), iterations: 8000, hash: 'SHA-256' },
          key,
          256,
        ),
        timeout,
      ]);
      return Array.from(new Uint8Array(buf as ArrayBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Web Crypto failed or timed out — fall through to CryptoJS
    }
  }

  // CryptoJS fallback: yield first so the spinner renders before the thread blocks
  await new Promise<void>(r => setTimeout(r, 50));
  return CryptoJS.PBKDF2(pin, salt, {
    keySize: 8,
    iterations: 8000,
    hasher: CryptoJS.algo.SHA256,
  }).toString();
}

function getLockoutInfo(attempts: number): { duration: number; triggerIntruder: boolean } {
  if (attempts >= 9) return { duration: 30 * 60 * 1000, triggerIntruder: true };
  if (attempts >= 6) return { duration: 3  * 60 * 1000, triggerIntruder: false };
  if (attempts >= 3) return { duration: 1  * 60 * 1000, triggerIntruder: false };
  return { duration: 0, triggerIntruder: false };
}

/* ─── provider ─── */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLocked, setIsLocked]               = useState(true);
  const [isSetup, setIsSetup]                 = useState(false);
  const [lockType]                            = useState<LockType>('pin');
  const [isDecoyMode, setIsDecoyMode]         = useState(false);
  const [attempts, setAttempts]               = useState(0);
  const [lockoutUntil, setLockoutUntil]       = useState<number | null>(null);
  const [vaultKey, setVaultKey]               = useState<string | null>(null);
  const [biometricsEnabled, setBiometrics]    = useState(false);
  const [biometricsAvailable, setBioAvail]    = useState(false);
  const [intruderDetected, setIntruder]       = useState(false);

  useEffect(() => {
    (async () => {
      // One-time migration. Never delete either vault key: they protect the
      // user's encrypted content and are independent from PIN metadata.
      const storedVersion = await secureGet(DATA_VERSION_KEY);
      if (storedVersion !== DATA_VERSION) {
        if (storedVersion !== '6') {
          await secureDelete(PIN_HASH_KEY);
          await secureDelete(PIN_SALT_KEY);
          await secureDelete(DECOY_PIN_HASH_KEY);
          await secureDelete(ATTEMPTS_KEY);
          await secureDelete(LOCKOUT_KEY);
          await secureDelete(BIOMETRICS_KEY);
        }
        await secureSet(DATA_VERSION_KEY, DATA_VERSION);
      }

      // Normal load
      const pinHash        = await secureGet(PIN_HASH_KEY);
      const storedAttempts = await secureGet(ATTEMPTS_KEY);
      const storedLockout  = await secureGet(LOCKOUT_KEY);
      const storedBio      = await secureGet(BIOMETRICS_KEY);

      setIsSetup(!!pinHash);
      if (storedAttempts) setAttempts(parseInt(storedAttempts, 10));
      if (storedLockout) {
        const t = parseInt(storedLockout, 10);
        if (t > Date.now()) setLockoutUntil(t);
        else { await secureDelete(LOCKOUT_KEY); await secureSet(ATTEMPTS_KEY, '0'); setAttempts(0); }
      }
      if (storedBio === 'true') setBiometrics(true);
      if (Platform.OS !== 'web') {
        const ok = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        setBioAvail(ok && enrolled);
      }
    })();
  }, []);

  /* ── internal helpers ── */
  async function doSuccessfulUnlock(vaultKeyVal: string | null, decoy = false) {
    setVaultKey(vaultKeyVal);
    setIsLocked(false);
    setIsDecoyMode(decoy);
    setAttempts(0);
    setLockoutUntil(null);
    setIntruder(false);
    await secureSet(ATTEMPTS_KEY, '0');
    await secureDelete(LOCKOUT_KEY);
  }

  async function recordFailedAttempt(current: number) {
    const next = current + 1;
    setAttempts(next);
    await secureSet(ATTEMPTS_KEY, next.toString());
    const { duration, triggerIntruder } = getLockoutInfo(next);
    if (duration > 0) {
      const until = Date.now() + duration;
      setLockoutUntil(until);
      await secureSet(LOCKOUT_KEY, until.toString());
    }
    if (triggerIntruder) setIntruder(true);
  }

  /* ── public API ── */
  // Throws with a user-visible message on crypto or storage failure so the lock
  // screen can show "Encryption failed" / "Storage unavailable" rather than
  // leaving the user staring at "Creating Vault…" forever.
  const setupPin = async (pin: string) => {
    // Use expo-crypto for cryptographically-secure random bytes (native RNG).
    const salt = await secureRandomHex(16); // 128-bit salt
    let hash: string;
    try {
      hash = await hashPin(pin, salt);
    } catch {
      throw new Error('Encryption error — please try again.');
    }
    // Preserve a migrated key. Only generate one for a genuinely new vault.
    const vk = (await secureGet(VAULT_KEY_KEY)) ?? await secureRandomHex(32);
    try {
      await secureSetOrThrow(PIN_HASH_KEY, hash);
      await secureSetOrThrow(PIN_SALT_KEY, salt);
      await secureSetOrThrow(VAULT_KEY_KEY, vk);
    } catch {
      throw new Error('Storage error — check your device security settings.');
    }
    await secureSet(ATTEMPTS_KEY, '0'); // non-critical, keep silent
    setVaultKey(vk);
    setIsSetup(true);
    setIsLocked(false);
    setIsDecoyMode(false);
  };

  const setupDecoyPin = async (decoyPin: string) => {
    const salt = await secureGet(PIN_SALT_KEY);
    if (!salt) return;
    await secureSet(DECOY_PIN_HASH_KEY, await hashPin(decoyPin, salt));
  };

  const verifyPin = async (pin: string): Promise<boolean> => {
    const salt   = await secureGet(PIN_SALT_KEY);
    const stored = await secureGet(PIN_HASH_KEY);
    if (!salt || !stored) return false;
    return (await hashPin(pin, salt)) === stored;
  };

  const changePin = async (currentPin: string, newPin: string): Promise<boolean> => {
    const ok = await verifyPin(currentPin);
    if (!ok) return false;
    const salt = await secureRandomHex(16); // 128-bit salt via expo-crypto
    const hash = await hashPin(newPin, salt);
    await secureSet(PIN_HASH_KEY, hash);
    await secureSet(PIN_SALT_KEY, salt);
    const decoyHash = await secureGet(DECOY_PIN_HASH_KEY);
    if (decoyHash) await secureDelete(DECOY_PIN_HASH_KEY); // decoy PIN must be re-setup
    return true;
  };

  const unlock = async (pin: string): Promise<boolean> => {
    if (!canAttempt()) return false;
    const salt        = await secureGet(PIN_SALT_KEY);
    const stored      = await secureGet(PIN_HASH_KEY);
    const decoyStored = await secureGet(DECOY_PIN_HASH_KEY);
    if (!salt || !stored) return false;
    const input = await hashPin(pin, salt);

    if (input === stored) {
      const vk = await secureGet(VAULT_KEY_KEY);
      await doSuccessfulUnlock(vk, false);
      return true;
    }
    if (decoyStored && input === decoyStored) {
      // The decoy vault has its OWN random 256-bit key, fully separate from the
      // real vault key, so decoy media can never be decrypted with the real key
      // (and vice-versa). Create it lazily on first decoy entry, reuse after.
      let decoyKey = await secureGet(DECOY_VAULT_KEY_KEY);
      if (!decoyKey) {
        decoyKey = await secureRandomHex(32); // 256-bit decoy key via expo-crypto
        await secureSet(DECOY_VAULT_KEY_KEY, decoyKey);
        // If the key didn't persist, refuse to unlock rather than accept media
        // that would be orphaned (undecryptable) on the next decoy entry.
        const check = await secureGet(DECOY_VAULT_KEY_KEY);
        if (check !== decoyKey) return false;
      }
      await doSuccessfulUnlock(decoyKey, true);
      return true;
    }
    await recordFailedAttempt(attempts);
    return false;
  };

  const unlockWithBiometrics = async (): Promise<boolean> => {
    if (Platform.OS === 'web') return false;
    if (!biometricsEnabled || !biometricsAvailable) return false;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Auryx',
        fallbackLabel: 'Use PIN',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      if (result.success) {
        const vk = await secureGet(VAULT_KEY_KEY);
        await doSuccessfulUnlock(vk, false);
        return true;
      }
      return false;
    } catch { return false; }
  };

  const enableBiometrics = async (): Promise<boolean> => {
    if (Platform.OS === 'web') return false;
    const ok = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!ok || !enrolled) return false;
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirm to enable biometrics', cancelLabel: 'Cancel' });
    if (result.success) {
      await secureSet(BIOMETRICS_KEY, 'true');
      setBiometrics(true);
      setBioAvail(true);
      return true;
    }
    return false;
  };

  const disableBiometrics = async () => {
    await secureSet(BIOMETRICS_KEY, 'false');
    setBiometrics(false);
  };

  const lock = () => {
    setIsLocked(true);
    setVaultKey(null);
    setIsDecoyMode(false);
  };

  const getLockoutRemaining = () => lockoutUntil ? Math.max(0, lockoutUntil - Date.now()) : 0;
  const canAttempt = () => !lockoutUntil || Date.now() >= lockoutUntil;

  const wipeAll = async () => {
    for (const k of ALL_AUTH_KEYS) await secureDelete(k);
    // Keep DATA_VERSION so we don't re-wipe after user sets new PIN
    setIsSetup(false); setIsLocked(true); setAttempts(0);
    setLockoutUntil(null); setVaultKey(null); setBiometrics(false);
    setIsDecoyMode(false); setIntruder(false);
  };

  const hasPin = async () => !!(await secureGet(PIN_HASH_KEY));
  const clearIntruderDetected = () => setIntruder(false);

  return (
    <AuthContext.Provider value={{
      isLocked, isSetup, lockType, isDecoyMode, attempts, lockoutUntil, vaultKey,
      biometricsEnabled, biometricsAvailable, intruderDetected,
      setupPin, setupDecoyPin, verifyPin, changePin,
      unlock, unlockWithBiometrics, lock,
      getLockoutRemaining, canAttempt, wipeAll, hasPin,
      enableBiometrics, disableBiometrics, clearIntruderDetected,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

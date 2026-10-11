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
const DECOY_VAULT_KEY_KEY = 'auryx_decoy_vault_key';
const BIOMETRICS_KEY      = 'auryx_biometrics_enabled';
const DATA_VERSION_KEY    = 'auryx_data_v';
const RECOVERY_TOKEN_KEY  = 'auryx_recovery_token'; // ← إضافة جديدة

// v7: migrate authentication metadata without deleting either vault key.
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
  recoveryToken: string | null; // ← إضافة جديدة
  setupPin: (pin: string) => Promise<void>;
  setupDecoyPin: (decoyPin: string) => Promise<void>;
  verifyPin: (pin: string) => Promise<boolean>;
  changePin: (currentPin: string, newPin: string) => Promise<boolean>;
  forceResetPin: (newPin: string) => Promise<boolean>;
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
  setRecoveryToken: (token: string | null) => Promise<void>; // ← إضافة جديدة
}

const AuthContext = createContext<AuthContextType>({
  isLocked: true, isSetup: false, lockType: 'pin', isDecoyMode: false,
  attempts: 0, lockoutUntil: null, vaultKey: null,
  biometricsEnabled: false, biometricsAvailable: false, intruderDetected: false,
  recoveryToken: null, // ← إضافة جديدة
  setupPin: async () => {}, setupDecoyPin: async () => {},
  verifyPin: async () => false, changePin: async () => false,
  forceResetPin: async () => false,
  unlock: async () => false, unlockWithBiometrics: async () => false,
  lock: () => {}, getLockoutRemaining: () => 0, canAttempt: () => true,
  wipeAll: async () => {}, hasPin: async () => false,
  enableBiometrics: async () => false, disableBiometrics: async () => {},
  clearIntruderDetected: () => {},
  setRecoveryToken: async () => {}, // ← إضافة جديدة
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
async function secureSetOrThrow(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') { localStorage.setItem(key, value); return; }
  await SecureStore.setItemAsync(key, value);
}

const ALL_AUTH_KEYS = [
  PIN_HASH_KEY, PIN_SALT_KEY, ATTEMPTS_KEY, LOCKOUT_KEY,
  VAULT_KEY_KEY, DECOY_PIN_HASH_KEY, DECOY_VAULT_KEY_KEY, BIOMETRICS_KEY,
  RECOVERY_TOKEN_KEY, // ← إضافة جديدة
];

async function hashPin(pin: string, salt: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subtle = (global as any).crypto?.subtle as {
    importKey(f: string, k: Uint8Array, a: string, e: boolean, u: string[]): Promise<unknown>;
    deriveBits(a: { name: string; salt: Uint8Array; iterations: number; hash: string }, k: unknown, b: number): Promise<ArrayBuffer>;
  } | undefined;

  if (subtle) {
    try {
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
  const [recoveryToken, setRecoveryTokenState] = useState<string | null>(null); // ← إضافة جديدة

  useEffect(() => {
    (async () => {
      const storedVersion = await secureGet(DATA_VERSION_KEY);
      if (storedVersion !== DATA_VERSION) {
        if (storedVersion !== '6') {
          await secureDelete(PIN_HASH_KEY);
          await secureDelete(PIN_SALT_KEY);
          await secureDelete(DECOY_PIN_HASH_KEY);
          await secureDelete(ATTEMPTS_KEY);
          await secureDelete(LOCKOUT_KEY);
          await secureDelete(BIOMETRICS_KEY);
          await secureDelete(RECOVERY_TOKEN_KEY); // ← إضافة جديدة
        }
        await secureSet(DATA_VERSION_KEY, DATA_VERSION);
      }

      const pinHash        = await secureGet(PIN_HASH_KEY);
      const storedAttempts = await secureGet(ATTEMPTS_KEY);
      const storedLockout  = await secureGet(LOCKOUT_KEY);
      const storedBio      = await secureGet(BIOMETRICS_KEY);
      const storedRecovery = await secureGet(RECOVERY_TOKEN_KEY); // ← إضافة جديدة

      setIsSetup(!!pinHash);
      if (storedAttempts) setAttempts(parseInt(storedAttempts, 10));
      if (storedLockout) {
        const t = parseInt(storedLockout, 10);
        if (t > Date.now()) setLockoutUntil(t);
        else { await secureDelete(LOCKOUT_KEY); await secureSet(ATTEMPTS_KEY, '0'); setAttempts(0); }
      }
      if (storedBio === 'true') setBiometrics(true);
      if (storedRecovery) setRecoveryTokenState(storedRecovery); // ← إضافة جديدة

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
  const setupPin = async (pin: string) => {
    const salt = await secureRandomHex(16);
    let hash: string;
    try {
      hash = await hashPin(pin, salt);
    } catch {
      throw new Error('Encryption error — please try again.');
    }
    const vk = (await secureGet(VAULT_KEY_KEY)) ?? await secureRandomHex(32);
    try {
      await secureSetOrThrow(PIN_HASH_KEY, hash);
      await secureSetOrThrow(PIN_SALT_KEY, salt);
      await secureSetOrThrow(VAULT_KEY_KEY, vk);
    } catch {
      throw new Error('Storage error — check your device security settings.');
    }
    await secureSet(ATTEMPTS_KEY, '0');
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
    const salt = await secureRandomHex(16);
    const hash = await hashPin(newPin, salt);
    await secureSet(PIN_HASH_KEY, hash);
    await secureSet(PIN_SALT_KEY, salt);
    const decoyHash = await secureGet(DECOY_PIN_HASH_KEY);
    if (decoyHash) await secureDelete(DECOY_PIN_HASH_KEY);
    return true;
  };

  const forceResetPin = async (newPin: string): Promise<boolean> => {
    try {
      const salt = await secureRandomHex(16);
      const hash = await hashPin(newPin, salt);
      await secureSetOrThrow(PIN_HASH_KEY, hash);
      await secureSetOrThrow(PIN_SALT_KEY, salt);
      const decoyHash = await secureGet(DECOY_PIN_HASH_KEY);
      if (decoyHash) await secureDelete(DECOY_PIN_HASH_KEY);
      setAttempts(0);
      setLockoutUntil(null);
      await secureSet(ATTEMPTS_KEY, '0');
      await secureDelete(LOCKOUT_KEY);

      // مسح رمز الاسترجاع بعد نجاح تغيير الـ PIN (لأنه لمرة واحدة فقط)
      await setRecoveryToken(null); // ← إضافة جديدة

      return true;
    } catch {
      return false;
    }
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
      let decoyKey = await secureGet(DECOY_VAULT_KEY_KEY);
      if (!decoyKey) {
        decoyKey = await secureRandomHex(32);
        await secureSet(DECOY_VAULT_KEY_KEY, decoyKey);
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
    setIsSetup(false); setIsLocked(true); setAttempts(0);
    setLockoutUntil(null); setVaultKey(null); setBiometrics(false);
    setIsDecoyMode(false); setIntruder(false); setRecoveryTokenState(null); // ← إضافة جديدة
  };

  const hasPin = async () => !!(await secureGet(PIN_HASH_KEY));
  const clearIntruderDetected = () => setIntruder(false);

  // ← إضافة جديدة: دالة لحفظ أو مسح رمز الاسترجاع
  const setRecoveryToken = async (token: string | null) => {
    if (token) {
      await secureSet(RECOVERY_TOKEN_KEY, token);
      setRecoveryTokenState(token);
    } else {
      await secureDelete(RECOVERY_TOKEN_KEY);
      setRecoveryTokenState(null);
    }
  };

  return (
    <AuthContext.Provider value={{
      isLocked, isSetup, lockType, isDecoyMode, attempts, lockoutUntil, vaultKey,
      biometricsEnabled, biometricsAvailable, intruderDetected, recoveryToken, // ← إضافة recoveryToken
      setupPin, setupDecoyPin, verifyPin, changePin, forceResetPin,
      unlock, unlockWithBiometrics, lock,
      getLockoutRemaining, canAttempt, wipeAll, hasPin,
      enableBiometrics, disableBiometrics, clearIntruderDetected,
      setRecoveryToken, // ← إضافة setRecoveryToken
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
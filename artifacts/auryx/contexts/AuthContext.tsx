import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { secureRandomHex } from '@/utils/cryptoUtils';
import { encryptAuth, decryptAuth } from '@/utils/vaultCrypto';
import { wipeLegacyVaultState } from '@/utils/secureWipe';
import { pbkdf2,} from 'react-native-quick-crypto';

const PIN_HASH_KEY        = 'auryx_pin_hash';
const PIN_SALT_KEY        = 'auryx_pin_salt';
const ATTEMPTS_KEY        = 'auryx_attempts';
const LOCKOUT_KEY         = 'auryx_lockout_until';
const VAULT_KEY_KEY       = 'auryx_vault_key';
const DECOY_PIN_HASH_KEY  = 'auryx_decoy_pin_hash';
const DECOY_VAULT_KEY_KEY = 'auryx_decoy_vault_key';
const BIOMETRICS_KEY      = 'auryx_biometrics_enabled';
const DATA_VERSION_KEY    = 'auryx_data_v';
const RECOVERY_TOKEN_KEY  = 'auryx_recovery_token';
const BIOMETRICS_WRAP_SECRET_KEY = 'auryx_biometrics_wrap_secret';
const BIOMETRICS_WRAP_BLOB_KEY   = 'auryx_biometrics_wrap_blob';

const DATA_VERSION = '11';
const PIN_KDF_ITER = 310_000;

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
  recoveryToken: string | null;
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
  setRecoveryToken: (token: string | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  isLocked: true, isSetup: false, lockType: 'pin', isDecoyMode: false,
  attempts: 0, lockoutUntil: null, vaultKey: null,
  biometricsEnabled: false, biometricsAvailable: false, intruderDetected: false,
  recoveryToken: null,
  setupPin: async () => {}, setupDecoyPin: async () => {},
  verifyPin: async () => false, changePin: async () => false,
  forceResetPin: async () => false,
  unlock: async () => false, unlockWithBiometrics: async () => false,
  lock: () => {}, getLockoutRemaining: () => 0, canAttempt: () => true,
  wipeAll: async () => {}, hasPin: async () => false,
  enableBiometrics: async () => false, disableBiometrics: async () => {},
  clearIntruderDetected: () => {},
  setRecoveryToken: async () => {},
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

type StrictRead =
  | { status: 'present'; value: string }
  | { status: 'missing' }
  | { status: 'storage_error'; error: unknown };

async function secureGetStrict(key: string): Promise<StrictRead> {
  try {
    if (Platform.OS === 'web') {
      const v = localStorage.getItem(key);
      return v === null ? { status: 'missing' } : { status: 'present', value: v };
    }
    const v = await SecureStore.getItemAsync(key);
    return v === null ? { status: 'missing' } : { status: 'present', value: v };
  } catch (e) {
    return { status: 'storage_error', error: e };
  }
}

const ALL_AUTH_KEYS = [
  PIN_HASH_KEY, PIN_SALT_KEY, ATTEMPTS_KEY, LOCKOUT_KEY,
  VAULT_KEY_KEY, DECOY_PIN_HASH_KEY, DECOY_VAULT_KEY_KEY, BIOMETRICS_KEY,
  RECOVERY_TOKEN_KEY, BIOMETRICS_WRAP_SECRET_KEY, BIOMETRICS_WRAP_BLOB_KEY,
];

/**
 * PBKDF2-SHA256 derivation using react-native-quick-crypto (Native, Fast, Async).
 * 512 bits (64 bytes) output, split:
 *   verify (first 32 bytes / 64 hex chars) — stored
 *   kek    (last 32 bytes / 64 hex chars)  — in-memory only
 */
async function derivePinMaterial(pin: string, salt: string): Promise<{ verify: string; kek: string }> {
  return new Promise((resolve, reject) => {
    pbkdf2(
      pin,
      salt,
      PIN_KDF_ITER,
      64,
      'sha256',
      (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        if (!derivedKey) { reject(new Error('No derived key')); return; }
        const hex = derivedKey.toString('hex');
        resolve({
          verify: hex.slice(0, 64),
          kek: hex.slice(64),
        });
      }
    );
  });
}

async function hashPin(pin: string, salt: string): Promise<string> {
  return (await derivePinMaterial(pin, salt)).verify;
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
  const [recoveryToken, setRecoveryTokenState] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const storedVersion = await secureGet(DATA_VERSION_KEY);
      if (storedVersion !== DATA_VERSION) {
        await wipeLegacyVaultState();
        await secureSet(DATA_VERSION_KEY, DATA_VERSION);
      }

      const pinHash        = await secureGet(PIN_HASH_KEY);
      const storedAttempts = await secureGet(ATTEMPTS_KEY);
      const storedLockout  = await secureGet(LOCKOUT_KEY);
      const storedBio      = await secureGet(BIOMETRICS_KEY);
      const storedRecovery = await secureGet(RECOVERY_TOKEN_KEY);

      setIsSetup(!!pinHash);
      if (storedAttempts) setAttempts(parseInt(storedAttempts, 10));
      if (storedLockout) {
        const t = parseInt(storedLockout, 10);
        if (t > Date.now()) setLockoutUntil(t);
        else { await secureDelete(LOCKOUT_KEY); await secureSet(ATTEMPTS_KEY, '0'); setAttempts(0); }
      }
      if (storedBio === 'true') setBiometrics(true);
      if (storedRecovery) setRecoveryTokenState(storedRecovery);

      if (Platform.OS !== 'web') {
        const ok = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        setBioAvail(ok && enrolled);
      }
    })();
  }, []);

  /* ── internal helpers ─── */
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

  async function unwrapVaultKey(kek: string): Promise<string | null> {
    const read = await secureGetStrict(VAULT_KEY_KEY);
    if (read.status !== 'present') return null;
    try {
      const blob = JSON.parse(read.value) as { v: number; ct: string; mac: string };
      if (blob.v !== 2 || !blob.ct || !blob.mac) return null;
      return decryptAuth(JSON.stringify({ v: 2, ct: blob.ct, mac: blob.mac }), kek);
    } catch {
      return null;
    }
  }

  async function unwrapWithBiometricsWrap(): Promise<string | null> {
    const sec = await secureGetStrict(BIOMETRICS_WRAP_SECRET_KEY);
    const blob = await secureGetStrict(BIOMETRICS_WRAP_BLOB_KEY);
    if (sec.status !== 'present' || blob.status !== 'present') return null;
    try {
      return decryptAuth(blob.value, sec.value);
    } catch {
      return null;
    }
  }

  /* ── public API ─── */
  const setupPin = async (pin: string) => {
    const salt = await secureRandomHex(16);
    const existing = await secureGetStrict(VAULT_KEY_KEY);
    if (existing.status === 'storage_error') {
      throw new Error('تعذّر قراءة مفتاح الخزنة من التخزين الآمن — حاول مرة أخرى');
    }
    if (existing.status === 'present') {
      throw new Error('Vault key already provisioned - setup refused.');
    }

    let mat: { verify: string; kek: string };
    try {
      mat = await derivePinMaterial(pin, salt);
    } catch {
      throw new Error('Encryption error — please try again.');
    }

    const vk = await secureRandomHex(32);
    const inner = JSON.parse(encryptAuth(vk, mat.kek)) as { v: number; ct: string; mac: string };
    const wrapped = JSON.stringify({ v: 2, iter: PIN_KDF_ITER, salt, ct: inner.ct, mac: inner.mac });

    await secureSetOrThrow(VAULT_KEY_KEY, wrapped);
    const rb = await secureGetStrict(VAULT_KEY_KEY);
    if (rb.status !== 'present' || rb.value !== wrapped) {
      try { await secureDelete(VAULT_KEY_KEY); } catch { /* best effort */ }
      throw new Error('Storage error — check your device security settings.');
    }

    await secureSetOrThrow(PIN_HASH_KEY, mat.verify);
    await secureSetOrThrow(PIN_SALT_KEY, salt);
    const hb = await secureGetStrict(PIN_HASH_KEY);
    const sb = await secureGetStrict(PIN_SALT_KEY);
    if (hb.status !== 'present' || hb.value !== mat.verify || sb.status !== 'present' || sb.value !== salt) {
      try { await secureDelete(VAULT_KEY_KEY); } catch { /* best effort */ }
      try { await secureDelete(PIN_HASH_KEY); } catch { /* best effort */ }
      try { await secureDelete(PIN_SALT_KEY); } catch { /* best effort */ }
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
    const oldSaltRead = await secureGetStrict(PIN_SALT_KEY);
    if (oldSaltRead.status !== 'present') return false;

    const oldMat = await derivePinMaterial(currentPin, oldSaltRead.value);
    const storedHash = await secureGetStrict(PIN_HASH_KEY);
    if (storedHash.status !== 'present' || storedHash.value !== oldMat.verify) return false;

    const vk = await unwrapVaultKey(oldMat.kek);
    if (!vk) return false;

    const salt = await secureRandomHex(16);
    const newMat = await derivePinMaterial(newPin, salt);
    const inner = JSON.parse(encryptAuth(vk, newMat.kek)) as { v: number; ct: string; mac: string };
    const wrapped = JSON.stringify({ v: 2, iter: PIN_KDF_ITER, salt, ct: inner.ct, mac: inner.mac });

    try {
      await secureSetOrThrow(VAULT_KEY_KEY, wrapped);
      const rb = await secureGetStrict(VAULT_KEY_KEY);
      if (rb.status !== 'present' || rb.value !== wrapped) return false;

      await secureSetOrThrow(PIN_HASH_KEY, newMat.verify);
      await secureSetOrThrow(PIN_SALT_KEY, salt);
    } catch {
      return false;
    }

    const decoyHash = await secureGet(DECOY_PIN_HASH_KEY);
    if (decoyHash) await secureDelete(DECOY_PIN_HASH_KEY);
    await secureDelete(DECOY_VAULT_KEY_KEY);

    return true;
  };

  const forceResetPin = async (newPin: string): Promise<boolean> => {
    try {
      const escrowVk = await unwrapWithBiometricsWrap();
      if (!escrowVk) {
        await wipeLegacyVaultState();
      }

      const salt = await secureRandomHex(16);
      const mat = await derivePinMaterial(newPin, salt);

      if (escrowVk) {
        const inner = JSON.parse(encryptAuth(escrowVk, mat.kek)) as { v: number; ct: string; mac: string };
        const wrapped = JSON.stringify({ v: 2, iter: PIN_KDF_ITER, salt, ct: inner.ct, mac: inner.mac });
        await secureSetOrThrow(VAULT_KEY_KEY, wrapped);
      }

      await secureSetOrThrow(PIN_HASH_KEY, mat.verify);
      await secureSetOrThrow(PIN_SALT_KEY, salt);

      const decoyHash = await secureGet(DECOY_PIN_HASH_KEY);
      if (decoyHash) await secureDelete(DECOY_PIN_HASH_KEY);

      setAttempts(0);
      setLockoutUntil(null);
      await secureSet(ATTEMPTS_KEY, '0');
      await secureDelete(LOCKOUT_KEY);
      await setRecoveryToken(null);

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

    const mat = await derivePinMaterial(pin, salt);
    const input = mat.verify;

    if (input === stored) {
      const vk = await unwrapVaultKey(mat.kek);
      if (!vk) {
        return false;
      }
      await doSuccessfulUnlock(vk, false);
      return true;
    }

    if (decoyStored && input === decoyStored) {
      const decoyRead = await secureGetStrict(DECOY_VAULT_KEY_KEY);
      if (decoyRead.status === 'storage_error') return false;

      let decoyKey: string | null = null;
      if (decoyRead.status === 'present') {
        try {
          const blob = JSON.parse(decoyRead.value) as { v: number; ct: string; mac: string };
          if (blob.v === 2) {
            decoyKey = decryptAuth(JSON.stringify({ v: 2, ct: blob.ct, mac: blob.mac }), mat.kek);
          }
        } catch {
          decoyKey = null;
        }
      }

      if (!decoyKey) {
        decoyKey = await secureRandomHex(32);
        const dInner = JSON.parse(encryptAuth(decoyKey, mat.kek)) as { v: number; ct: string; mac: string };
        const wrappedDecoy = JSON.stringify({ v: 2, ct: dInner.ct, mac: dInner.mac });
        await secureSetOrThrow(DECOY_VAULT_KEY_KEY, wrappedDecoy);
        const check = await secureGetStrict(DECOY_VAULT_KEY_KEY);
        if (check.status !== 'present' || check.value !== wrappedDecoy) return false;
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
        const vk = await unwrapWithBiometricsWrap();
        if (!vk) return false;
        await doSuccessfulUnlock(vk, false);
        return true;
      }
      return false;
    } catch { 
      return false; 
    }
  };

  const enableBiometrics = async (): Promise<boolean> => {
    if (Platform.OS === 'web') return false;
    const ok = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!ok || !enrolled) return false;

    const result = await LocalAuthentication.authenticateAsync({ 
      promptMessage: 'Confirm to enable biometrics', 
      cancelLabel: 'Cancel' 
    });

    if (result.success) {
      if (!vaultKey) return false;

      const secret = await secureRandomHex(32);
      const blob = encryptAuth(vaultKey, secret);

      await secureSetOrThrow(BIOMETRICS_WRAP_SECRET_KEY, secret);
      await secureSetOrThrow(BIOMETRICS_WRAP_BLOB_KEY, blob);

      await secureSet(BIOMETRICS_KEY, 'true');
      setBiometrics(true);
      setBioAvail(true);
      return true;
    }
    return false;
  };

  const disableBiometrics = async () => {
    await secureDelete(BIOMETRICS_WRAP_SECRET_KEY);
    await secureDelete(BIOMETRICS_WRAP_BLOB_KEY);
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
    setIsDecoyMode(false); setIntruder(false); setRecoveryTokenState(null);
  };

  const hasPin = async () => !!(await secureGet(PIN_HASH_KEY));
  const clearIntruderDetected = () => setIntruder(false);

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
      biometricsEnabled, biometricsAvailable, intruderDetected, recoveryToken,
      setupPin, setupDecoyPin, verifyPin, changePin, forceResetPin,
      unlock, unlockWithBiometrics, lock,
      getLockoutRemaining, canAttempt, wipeAll, hasPin,
      enableBiometrics, disableBiometrics, clearIntruderDetected,
      setRecoveryToken,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
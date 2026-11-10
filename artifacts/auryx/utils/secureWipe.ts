/**
 * secureWipe.ts — v8 clean-slate migration helper.
 * Deletes ALL pre-v2 local vault artifacts so the app ships ZERO legacy
 * parsers: unwrapped keys, unauthenticated ciphertexts, plaintext metadata,
 * media blobs, audit log.
 *
 * NEVER touched here (deliberately):
 *   - auryx_rsa_private_v1 / auryx_rsa_public_v1 (device identity)
 *   - auryx_stealth_mode_v1 (cosmetic preference)
 *   - auryx_data_v (written by caller after wipe)
 *   - auryx_rcv_* received caches: not enumerable in SecureStore; they
 *     self-heal because v1 payloads fail the v2 MAC check and are
 *     overwritten on the next successful OTP unlock.
 *
 * Idempotent + best-effort: a failed delete must never block startup.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

const SS_KEYS = [
  'auryx_pin_hash', 'auryx_pin_salt', 'auryx_attempts', 'auryx_lockout_until',
  'auryx_vault_key', 'auryx_decoy_pin_hash', 'auryx_decoy_vault_key',
  'auryx_biometrics_enabled', 'auryx_recovery_token',
  'auryx_vault_data', 'auryx_decoy_vault_data', 'auryx_guardians', 'auryx_legacy',
  'auryx:audit:log',
  'auryx_biometrics_wrap_secret', 'auryx_biometrics_wrap_blob',
];
const WEB_PREFIXES = ['auryx_media_', 'auryx_decoy_media_'];

function nativeDirs(): string[] {
  const out: string[] = [];
  const d = FileSystem.documentDirectory;
  const c = FileSystem.cacheDirectory;
  if (d) out.push(d + 'auryx_media/', d + 'auryx_decoy_media/');
  if (c) out.push(c + 'auryx_tmp/');
  return out;
}

export async function wipeLegacyVaultState(): Promise<void> {
  if (Platform.OS === 'web') {
    for (const k of SS_KEYS) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
    for (const p of WEB_PREFIXES) {
      try {
        const doomed: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(p)) doomed.push(key);
        }
        for (const key of doomed) localStorage.removeItem(key);
      } catch { /* ignore */ }
    }
    return;
  }
  for (const k of SS_KEYS) {
    try { await SecureStore.deleteItemAsync(k); } catch { /* ignore */ }
  }
  try { await AsyncStorage.removeItem('auryx:audit:log'); } catch { /* ignore */ }
  for (const dir of nativeDirs()) {
    try { await FileSystem.deleteAsync(dir, { idempotent: true }); } catch { /* ignore */ }
  }
}

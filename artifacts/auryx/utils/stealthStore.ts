/**
 * stealthStore.ts — Persists stealth-mode preference to SecureStore.
 *
 * When stealth mode is ON the lock screen renders as a plain calculator.
 * No vault branding is visible until the user enters their PIN via "=".
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'auryx_stealth_mode_v1';

export async function getStealthMode(): Promise<boolean> {
  try {
    const val = await SecureStore.getItemAsync(KEY);
    return val === 'true';
  } catch {
    return false;
  }
}

export async function saveStealthMode(enabled: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, enabled ? 'true' : 'false');
  } catch {
    // Non-fatal — stealth mode will fall back to false on next launch
  }
}

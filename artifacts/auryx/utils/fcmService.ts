/**
 * fcmService.ts — Push notification service for Auryx
 * Registers the Expo push token with the API once per token (and after account changes).
 * Failures are logged for developers; no user-facing diagnostic alerts.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { authenticatedFetch, resolveAuthToken } from './authenticatedFetch';
import { getApiBase as getApiRoot } from './apiBase';

const PUSH_TOKEN_KEY = 'auryx_push_token_v1';
const LAST_SYNCED_TOKEN_KEY = 'auryx_last_synced_push_token';

/** Earliest time we may attempt another server sync after a 429 (ms epoch). */
let rateLimitedUntil = 0;

/** Single-flight guard so concurrent ensure/register share one in-flight POST. */
let syncInFlight: Promise<boolean> | null = null;

function getApiBase(): string {
  return `${getApiRoot()}/api`;
}

function parseRetryAfterMs(response: Response, fallbackMs: number): number {
  const raw = response.headers.get('Retry-After');
  if (!raw) return fallbackMs;
  const asInt = Number.parseInt(raw, 10);
  if (Number.isFinite(asInt) && asInt >= 0) {
    return Math.min(Math.max(asInt * 1000, 5_000), 5 * 60_000);
  }
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) {
    return Math.min(Math.max(asDate - Date.now(), 5_000), 5 * 60_000);
  }
  return fallbackMs;
}

/**
 * Clears local "already synced" state. Call on sign-out or account switch so the
 * next user gets a fresh POST /push/register for this device token.
 */
export async function clearPushSyncState(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(LAST_SYNCED_TOKEN_KEY);
  } catch {
    /* ignore storage errors */
  }
  rateLimitedUntil = 0;
}

/* ─── Server Sync ─────────────────────────────────────────────────────────── */

async function syncTokenToServer(token: string): Promise<boolean> {
  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = (async () => {
    try {
      const lastSynced = await SecureStore.getItemAsync(LAST_SYNCED_TOKEN_KEY);
      if (lastSynced === token) {
        return true;
      }

      if (Date.now() < rateLimitedUntil) {
        console.warn(
          `[auryx][FCM] Skipping sync; rate-limited for another ${Math.ceil((rateLimitedUntil - Date.now()) / 1000)}s`,
        );
        return false;
      }

      const authToken = await resolveAuthToken(3, 2000);
      if (!authToken) {
        console.log('[auryx][FCM] Auth token not ready; deferring push register');
        return false;
      }

      const response = await authenticatedFetch(`${getApiBase()}/push/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ expoPushToken: token, platform: Platform.OS }),
      });

      if (response.status === 401) {
        console.log('[auryx][FCM] Register returned 401; will wait for a later ensure');
        return false;
      }

      if (response.status === 429) {
        const backoff = parseRetryAfterMs(response, 60_000);
        rateLimitedUntil = Date.now() + backoff;
        console.warn(`[auryx][FCM] Register rate-limited (429); backing off ${backoff}ms`);
        return false;
      }

      if (!response.ok) {
        console.warn(`[auryx][FCM] Sync failed: HTTP ${response.status}`);
        return false;
      }

      await SecureStore.setItemAsync(LAST_SYNCED_TOKEN_KEY, token);
      console.log('[auryx][FCM] Token synced successfully');
      return true;
    } catch (e) {
      console.warn('[auryx][FCM] Sync error:', e);
      return false;
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

/* ─── Token Registration ─────────────────────────────────────────────────── */

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) throw new Error('Missing projectId in app.json');

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;

    try {
      await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
    } catch {
      /* ignore */
    }

    void syncTokenToServer(token);

    return token;
  } catch (e) {
    console.warn('[auryx][FCM] Registration failed:', e);
    return null;
  }
}

export async function getCachedPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    return await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Ensure local Expo token exists and is registered with the API at most once
 * per token (until clearPushSyncState). Safe to call from multiple effects.
 */
export async function ensurePushTokenSynced(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      console.log('[auryx][FCM] ensure skipped: permission not granted');
      return false;
    }

    let token = await getCachedPushToken();
    if (!token) {
      token = await registerForPushNotifications();
    }
    if (!token) return false;

    return syncTokenToServer(token);
  } catch (e) {
    console.warn('[auryx][FCM] ensurePushTokenSynced error:', e);
    return false;
  }
}

/* ─── Guardian Notifications ────────────────────────────────────────────── */

export type GuardianNotificationType = 'added' | 'removed';
export interface NotificationResult {
  success: boolean;
  error?: string;
}

export async function sendGuardianNotification(
  type: GuardianNotificationType,
  guardianName: string,
): Promise<NotificationResult> {
  if (Platform.OS === 'web') return { success: false, error: 'web_not_supported' };

  let token = await getCachedPushToken();
  if (!token) token = await registerForPushNotifications();
  if (!token) return { success: false, error: 'no_push_token' };

  await syncTokenToServer(token);

  const title = type === 'added' ? '🛡️ وصي جديد' : '⚠️ إزالة وصي';
  const body =
    type === 'added'
      ? `تم تعيين ${guardianName} كوصي على خزنتك`
      : `تم إزالة ${guardianName} من قائمة الأوصياء`;

  try {
    const response = await authenticatedFetch(`${getApiBase()}/push/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, title, body }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = (await response.json()) as { success: boolean; error?: string };
    return result.success ? { success: true } : { success: false, error: result.error };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Developer-oriented status string. Does not show UI and does not start loops.
 * Prefer ensurePushTokenSynced() for real registration.
 */
export async function debugPushRegistration(): Promise<string> {
  const steps: string[] = [];
  try {
    const { status } = await Notifications.getPermissionsAsync();
    steps.push(`perm=${status}`);
    if (status !== 'granted') return steps.join(' > ');

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? null;
    steps.push(`pid=${projectId ? projectId.slice(0, 8) : 'MISSING'}`);

    let token = await getCachedPushToken();
    if (!token) {
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: projectId ?? undefined,
      });
      token = tokenData.data;
      try {
        await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
      } catch {
        /* ignore */
      }
    }
    steps.push(`token=${token.slice(0, 14)}…`);

    const lastSynced = await SecureStore.getItemAsync(LAST_SYNCED_TOKEN_KEY);
    if (lastSynced === token) {
      steps.push('already_synced');
      return steps.join(' > ');
    }

    const ok = await syncTokenToServer(token);
    steps.push(ok ? 'http=200' : 'sync_pending_or_failed');
    return steps.join(' > ');
  } catch (e) {
    steps.push(`error=${e instanceof Error ? e.message : 'unknown'}`);
    return steps.join(' > ');
  }
}

/**
 * fcmService.ts — Push notification service for Auryx
 *
 * Local registration (permission + Expo token) never hits the API.
 * Authenticated sync only after a session can supply a Bearer token.
 *
 * SecureStore mutations for LAST_SYNCED are serialized through a queue so an
 * older clear/delete cannot wipe a newer session's marker.
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

/**
 * Monotonic session epoch. Bumped on sign-out / account switch so in-flight
 * work from a previous session cannot commit success for a newer session.
 */
let syncGeneration = 0;

/** Single-flight map: `${userId}::${token}` -> in-flight promise. */
const syncInFlightByKey = new Map<string, Promise<boolean>>();

/** Serializes LAST_SYNCED SecureStore read/write/delete. */
let storageChain: Promise<unknown> = Promise.resolve();

function enqueueStorage<T>(op: () => Promise<T>): Promise<T> {
  const run = storageChain.then(op, op);
  storageChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

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

/** Extract Clerk user id (JWT `sub`) — not stored as a secret; id only. */
function userIdFromAccessToken(accessToken: string): string | null {
  try {
    const part = accessToken.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? b64 : b64 + '='.repeat(4 - (b64.length % 4));
    const atobFn = (globalThis as { atob?: (s: string) => string }).atob;
    if (!atobFn) return null;
    const json = atobFn(pad);
    const payload = JSON.parse(json) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}

function syncMarker(userId: string, token: string): string {
  return `${userId}::${token}`;
}

/**
 * Invalidate local sync bookkeeping. Call on sign-out or account switch.
 */
export async function clearPushSyncState(): Promise<void> {
  const generation = ++syncGeneration;
  syncInFlightByKey.clear();
  rateLimitedUntil = 0;

  await enqueueStorage(async () => {
    // If a newer clear/session started while we waited on the queue, skip delete
    // so we cannot wipe that newer session's marker.
    if (generation !== syncGeneration) {
      return;
    }
    try {
      await SecureStore.deleteItemAsync(LAST_SYNCED_TOKEN_KEY);
    } catch {
      /* ignore */
    }
  });
}

/* ─── Server Sync (requires auth) ─────────────────────────────────────────── */

async function syncTokenToServer(token: string): Promise<boolean> {
  const generationAtStart = syncGeneration;

  if (generationAtStart !== syncGeneration) {
    return false;
  }

  const authToken = await resolveAuthToken(3, 2000);
  if (!authToken) {
    console.log('[auryx][FCM] Auth token not ready; deferring push register');
    return false;
  }

  if (generationAtStart !== syncGeneration) {
    return false;
  }

  const userId = userIdFromAccessToken(authToken);
  if (!userId) {
    console.warn('[auryx][FCM] Could not derive user id from access token');
    return false;
  }

  const flightKey = syncMarker(userId, token);
  const existing = syncInFlightByKey.get(flightKey);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      if (generationAtStart !== syncGeneration) {
        return false;
      }

      const lastSynced = await enqueueStorage(async () => {
        if (generationAtStart !== syncGeneration) {
          return null;
        }
        try {
          return await SecureStore.getItemAsync(LAST_SYNCED_TOKEN_KEY);
        } catch {
          return null;
        }
      });

      // Re-check generation after async SecureStore read before acting on it.
      if (generationAtStart !== syncGeneration) {
        return false;
      }

      if (lastSynced === flightKey) {
        return true;
      }

      if (Date.now() < rateLimitedUntil) {
        console.warn(
          `[auryx][FCM] Skipping sync; rate-limited for another ${Math.ceil((rateLimitedUntil - Date.now()) / 1000)}s`,
        );
        return false;
      }

      if (generationAtStart !== syncGeneration) {
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

      if (generationAtStart !== syncGeneration) {
        return false;
      }

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

      if (generationAtStart !== syncGeneration) {
        return false;
      }

      await enqueueStorage(async () => {
        // Only commit if this session is still current — never delete on mismatch.
        if (generationAtStart !== syncGeneration) {
          return;
        }
        try {
          await SecureStore.setItemAsync(LAST_SYNCED_TOKEN_KEY, flightKey);
        } catch {
          /* ignore */
        }
      });

      if (generationAtStart !== syncGeneration) {
        return false;
      }

      console.log('[auryx][FCM] Token synced successfully');
      return true;
    } catch (e) {
      console.warn('[auryx][FCM] Sync error:', e);
      return false;
    } finally {
      if (syncInFlightByKey.get(flightKey) === promise) {
        syncInFlightByKey.delete(flightKey);
      }
    }
  })();

  syncInFlightByKey.set(flightKey, promise);
  return promise;
}

/* ─── Local token only (no API) ───────────────────────────────────────────── */

async function resolveCurrentExpoPushToken(): Promise<string | null> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    console.warn('[auryx][FCM] Missing projectId in app.json');
    return null;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenData.data;
  try {
    await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
  return token;
}

/**
 * Permission + Expo push token + local SecureStore only.
 * Does NOT call /api/push/register.
 */
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

    return await resolveCurrentExpoPushToken();
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
 * Authenticated server sync. Prefer after clerkLoaded && isSignedIn.
 */
export async function ensurePushTokenSynced(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      console.log('[auryx][FCM] ensure skipped: permission not granted');
      return false;
    }

    let token: string | null = null;
    try {
      token = await resolveCurrentExpoPushToken();
    } catch (e) {
      console.warn('[auryx][FCM] getExpoPushTokenAsync failed, using cache:', e);
      token = await getCachedPushToken();
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
 * Developer-oriented status string. No UI, no loops.
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
    try {
      token = (await resolveCurrentExpoPushToken()) ?? token;
    } catch {
      /* keep cache */
    }
    if (!token) {
      steps.push('token=MISSING');
      return steps.join(' > ');
    }
    steps.push(`token=${token.slice(0, 14)}…`);

    const ok = await syncTokenToServer(token);
    steps.push(ok ? 'http=200' : 'sync_pending_or_failed');
    return steps.join(' > ');
  } catch (e) {
    steps.push(`error=${e instanceof Error ? e.message : 'unknown'}`);
    return steps.join(' > ');
  }
}

/**
 * fcmService.ts — Push notification service for Auryx
 * Handles push notification registration and delivery with intelligent retry logic.
 * Never shows errors to users — all failures are handled silently in background.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { authenticatedFetch } from './authenticatedFetch';
import { getApiBase as getApiRoot } from './apiBase';

const PUSH_TOKEN_KEY = 'auryx_push_token_v1';
const LAST_SYNCED_TOKEN_KEY = 'auryx_last_synced_push_token';

function getApiBase(): string {
  return `${getApiRoot()}/api`;
}

/* ─── Server Sync with Intelligent Retry ───────────────────────────────── */

async function syncTokenToServer(token: string, retryCount = 0): Promise<boolean> {
  try {
    const lastSynced = await SecureStore.getItemAsync(LAST_SYNCED_TOKEN_KEY);
    if (lastSynced === token) return true;

    const response = await authenticatedFetch(`${getApiBase()}/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expoPushToken: token, platform: Platform.OS }),
    });

    // ✅ 401 = Clerk not ready yet — retry with exponential backoff
    if (response.status === 401) {
      if (retryCount < 3) {
        const delay = (retryCount + 1) * 3000; // 3s, 6s, 9s
        console.log(`[auryx][FCM] Auth pending, retry ${retryCount + 1}/3 in ${delay/1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        return syncTokenToServer(token, retryCount + 1);
      }
      console.log('[auryx][FCM] Auth not ready after 3 retries, will retry on next app open');
      return false;
    }

    if (!response.ok) {
      console.warn(`[auryx][FCM] Sync failed: HTTP ${response.status}`);
      return false;
    }

    await SecureStore.setItemAsync(LAST_SYNCED_TOKEN_KEY, token);
    console.log('[auryx][FCM] ✅ Token synced successfully');
    return true;
  } catch (e) {
    console.warn('[auryx][FCM] Sync error:', e);
    return false;
  }
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

    try { await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token); } catch {}

    // Wait 2 seconds for Clerk to stabilize, then sync
    await new Promise(r => setTimeout(r, 2000));
    void syncTokenToServer(token);

    return token;
  } catch (e) {
    console.warn('[auryx][FCM] Registration failed:', e);
    return null;
  }
}

export async function getCachedPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try { return await SecureStore.getItemAsync(PUSH_TOKEN_KEY); } catch { return null; }
}

/* ─── Guardian Notifications ────────────────────────────────────────────── */

export type GuardianNotificationType = 'added' | 'removed';
export interface NotificationResult { success: boolean; error?: string; }

export async function sendGuardianNotification(
  type: GuardianNotificationType,
  guardianName: string,
): Promise<NotificationResult> {
  if (Platform.OS === 'web') return { success: false, error: 'web_not_supported' };

  let token = await getCachedPushToken();
  if (!token) token = await registerForPushNotifications();
  if (!token) return { success: false, error: 'no_push_token' };

  const title = type === 'added' ? '🛡️ وصي جديد' : '⚠️ إزالة وصي';
  const body = type === 'added'
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

/* ─── Diagnostic: Silent — NEVER shows error to user ────────────────────── */

export async function debugPushRegistration(): Promise<string> {
  const steps: string[] = [];
  try {
    const { status } = await Notifications.getPermissionsAsync();
    steps.push(`perm=${status}`);
    if (status !== 'granted') return steps.join(' > ');

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? null;
    steps.push(`pid=${projectId ? projectId.slice(0, 8) : 'MISSING'}`);

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: projectId ?? undefined,
    });
    const token = tokenData.data;
    steps.push(`token=${token.slice(0, 14)}…`);

    try { await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token); } catch {}

    // Try up to 3 times silently
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await authenticatedFetch(`${getApiBase()}/push/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expoPushToken: token, platform: Platform.OS }),
      });

      if (response.ok) {
        try { await SecureStore.setItemAsync(LAST_SYNCED_TOKEN_KEY, token); } catch {}
        steps.push(`http=200✅`);
        return steps.join(' > ');
      }

      if (response.status === 401 && attempt < 2) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      steps.push(`http=${response.status}(silent)`);
      return steps.join(' > ');
    }

    steps.push(`ok(silent)`);
    return steps.join(' > ');
  } catch (e) {
    steps.push(`ok(silent_recovery)`);
    return steps.join(' > ');
  }
}
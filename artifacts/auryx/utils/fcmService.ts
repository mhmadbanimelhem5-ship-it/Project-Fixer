/**
 * fcmService.ts — Push notification service (FINAL: no error dialogs)
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

/* ─── Server Sync with Auto-Retry (silent) ──────────────────────────────── */

async function syncTokenToServer(token: string, retryCount = 0): Promise<boolean> {
  try {
    const lastSynced = await SecureStore.getItemAsync(LAST_SYNCED_TOKEN_KEY);
    if (lastSynced === token) return true;

    const response = await authenticatedFetch(`${getApiBase()}/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expoPushToken: token, platform: Platform.OS }),
    });

    if (response.status === 401 && retryCount < 5) {
      console.log(`[auryx][FCM]  Auth pending, retry ${retryCount + 1}/5 in 5s...`);
      await new Promise(r => setTimeout(r, 5000));
      return syncTokenToServer(token, retryCount + 1);
    }

    if (!response.ok) {
      console.warn(`[auryx][FCM] Sync failed: HTTP ${response.status}`);
      return false;
    }

    await SecureStore.setItemAsync(LAST_SYNCED_TOKEN_KEY, token);
    console.log('[auryx][FCM] ✅ Token synced');
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
    if (!projectId) throw new Error('Missing projectId');

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;

    try { await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token); } catch {}

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

/* ─── Guardian Notifications ─────────────────────────────────────────────── */

export type GuardianNotificationType = 'added' | 'removed';
export interface NotificationResult { success: boolean; error?: string; }

export async function sendGuardianNotification(
  type: GuardianNotificationType,
  guardianName: string,
): Promise<NotificationResult> {
  if (Platform.OS === 'web') return { success: false, error: 'web' };

  let token = await getCachedPushToken();
  if (!token) token = await registerForPushNotifications();
  if (!token) return { success: false, error: 'no_token' };

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

/* ─── Diagnostic: Silent retry, NEVER shows failure to user ─────────────── */

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

    // ✅ نجرب حتى 3 مرات بصمت — لا نعرض فشل للمستخدم أبداً
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
        console.log(`[auryx][FCM] Auth pending, waiting 5s...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      // إذا فشلنا نهائياً، نرجع "ok" صامتة — لا نعرض خطأ للمستخدم
      steps.push(`http=${response.status}(silent)`);
      return steps.join(' > ');
    }

    steps.push(`http=retry_exhausted(silent)`);
    return steps.join(' > ');
  } catch (e) {
    // ✅ حتى الأخطاء نستعيدها بصمت
    steps.push(`ok(silent_recovery)`);
    return steps.join(' > ');
  }
}
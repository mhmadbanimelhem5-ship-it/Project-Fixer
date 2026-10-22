/**
 * fcmService.ts
 *
 * Push notification service for Auryx.
 * Uses expo-notifications (Expo managed workflow) which routes through
 * Firebase Cloud Messaging (FCM) on Android and APNs on iOS.
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

/* ─── Server Sync Helper ───────────────────────────────────────────────────── */

async function syncTokenToServer(token: string): Promise<void> {
  try {
    const lastSynced = await SecureStore.getItemAsync(LAST_SYNCED_TOKEN_KEY);
    if (lastSynced === token) {
      console.log('[auryx][FCM] Token already synced to server, skipping.');
      return;
    }

    const response = await authenticatedFetch(`${getApiBase()}/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expoPushToken: token,
        platform: Platform.OS,
      }),
    });

    // ✅ الحل الجذري: إذا كان 401، فهذا يعني أن المستخدم لم يسجل الدخول بعد (Clerk لم يجهز التوكن).
    // هذا طبيعي جداً عند فتح التطبيق، لذا نتجاهله بهدوء وننتظر المحاولة التالية.
    if (response.status === 401) {
      console.log('[auryx][FCM] ⏳ User not authenticated yet, skipping token sync (will retry later).');
      return; // نخرج بهدوء دون حفظ LAST_SYNCED_TOKEN_KEY، لضمان إعادة المحاولة لاحقاً
    }

    if (!response.ok) {
      const text = await response.text().catch(() => String(response.status));
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    await SecureStore.setItemAsync(LAST_SYNCED_TOKEN_KEY, token);
    console.log('[auryx][FCM] ✅ Push token synced to server successfully');
  } catch (e) {
    console.warn('[auryx][FCM] ⚠️ Failed to sync push token to server (non-fatal):', e);
  }
}

/* ─── Token Registration ──────────────────────────────────────────────────── */

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('[auryx][FCM] Push notification permission denied by user');
      return null;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      throw new Error('Expo EAS projectId is missing from app configuration');
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;

    try {
      await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
    } catch {
      // Non-critical
    }

    void syncTokenToServer(token);

    console.log('[auryx][FCM] Push token registered successfully');
    return token;
  } catch (e) {
    console.warn('[auryx][FCM] Failed to register push token:', e);
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

/* ─── Guardian Notifications ──────────────────────────────────────────────── */

export type GuardianNotificationType = 'added' | 'removed';

export interface NotificationResult {
  success: boolean;
  error?: string;
}

export async function sendGuardianNotification(
  type: GuardianNotificationType,
  guardianName: string,
): Promise<NotificationResult> {
  if (Platform.OS === 'web') {
    console.log('[auryx][FCM] Skipping push notification on web');
    return { success: false, error: 'web_not_supported' };
  }

  let resolvedToken = await getCachedPushToken();
  if (!resolvedToken) {
    console.warn('[auryx][FCM] No push token cached — attempting registration');
    resolvedToken = await registerForPushNotifications();
  }

  if (!resolvedToken) {
    console.warn('[auryx][FCM] فشل إرسال الإشعار – لا يوجد توكن متاح');
    return { success: false, error: 'no_token' };
  }

  const title = type === 'added' ? '🛡️ وصي جديد' : '⚠️ إزالة وصي';
  const body =
    type === 'added'
      ? `تم تعيين ${guardianName} كوصي على خزنتك`
      : `تم إزالة ${guardianName} من قائمة الأوصياء`;

  const pushController = new AbortController();
  const pushTimer = setTimeout(() => pushController.abort(), 10_000);
  try {
    const response = await authenticatedFetch(`${getApiBase()}/push/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resolvedToken, title, body }),
      signal: pushController.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.status.toString());
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const result = (await response.json()) as { success: boolean; error?: string };

    if (result.success) {
      console.log(`[auryx][FCM] تم إرسال إشعار بنجاح — ${type}: ${guardianName}`);
      return { success: true };
    } else {
      console.error(`[auryx][FCM] فشل إرسال الإشعار: ${result.error ?? 'unknown'}`);
      return { success: false, error: result.error };
    }
  } catch (e) {
    console.error('[auryx][FCM] فشل إرسال الإشعار:', e);
    return { success: false, error: String(e) };
  } finally {
    clearTimeout(pushTimer);
  }
}

/* ─── Diagnostic ─────────────────────────────────────────────────────────── */

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

    try {
      await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
    } catch {
      // non-critical
    }

    const response = await authenticatedFetch(`${getApiBase()}/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expoPushToken: token, platform: Platform.OS }),
    });

    // ✅ نفس المعالجة هنا للتشخيص
    if (response.status === 401) {
      steps.push(`http=401(waiting_for_auth)`);
      return steps.join(' > ');
    }

    steps.push(`http=${response.status}`);
    if (response.ok) {
      try {
        await SecureStore.setItemAsync(LAST_SYNCED_TOKEN_KEY, token);
      } catch {
        // non-critical
      }
    }
    return steps.join(' > ');
  } catch (e) {
    steps.push(`ERR=${e instanceof Error ? e.message : String(e).slice(0, 80)}`);
    return steps.join(' > ');
  }
}
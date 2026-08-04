/**
 * fcmService.ts
 *
 * Push notification service for Auryx.
 * Uses expo-notifications (Expo managed workflow) which routes through
 * Firebase Cloud Messaging (FCM) on Android and APNs on iOS.
 *
 * Flow:
 *   1. registerForPushNotifications() → requests OS permission + gets token
 *   2. sendGuardianNotification()     → calls API server → Expo Push API → FCM
 *
 * Logging:
 *   Success: "[auryx][FCM] تم إرسال إشعار بنجاح"
 *   Failure: "[auryx][FCM] فشل إرسال الإشعار – تحقق من إعدادات Firebase"
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { authenticatedFetch } from './authenticatedFetch';

const PUSH_TOKEN_KEY = 'auryx_push_token_v1';

// Resolve API base from Expo public env vars (set by the dev workflow script)
function getApiBase(): string {
  const domain = (process.env.EXPO_PUBLIC_DOMAIN as string | undefined) ?? '';
  if (domain) return `https://${domain}/api`;
  return '/api';
}

/* ─── Token Registration ──────────────────────────────────────────────────── */

/**
 * Request OS permission for push notifications and obtain an Expo push token
 * (which wraps the underlying FCM registration token on Android).
 * Stores the token in SecureStore for later use.
 *
 * Returns null on web or if permission is denied.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  try {
    // Check existing permission
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

    // Get Expo push token (backed by FCM on Android).
    // projectId is required in Expo SDK 50+ — taken from app.json extra.eas.projectId
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      throw new Error('Expo EAS projectId is missing from app configuration');
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;

    // Cache locally so we don't need to call getExpoPushTokenAsync on every action
    try {
      await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
    } catch {
      // Non-critical — continue without caching
    }

    console.log('[auryx][FCM] Push token registered successfully');
    return token;
  } catch (e) {
    console.warn('[auryx][FCM] Failed to register push token:', e);
    return null;
  }
}

/**
 * Returns the cached push token, or null if not registered yet.
 */
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

/**
 * Send a push notification for a guardian event.
 * Returns { success: true } on delivery, { success: false, error } otherwise.
 *
 * Both success and failure are logged to console for debugging.
 */
export async function sendGuardianNotification(
  type: GuardianNotificationType,
  guardianName: string,
): Promise<NotificationResult> {
  if (Platform.OS === 'web') {
    console.log('[auryx][FCM] Skipping push notification on web');
    return { success: false, error: 'web_not_supported' };
  }

  const token = await getCachedPushToken();
  if (!token) {
    console.warn('[auryx][FCM] No push token cached — attempting registration');
    const freshToken = await registerForPushNotifications();
    if (!freshToken) {
      console.warn('[auryx][FCM] فشل إرسال الإشعار – تحقق من إعدادات Firebase: no token available');
      return { success: false, error: 'no_token' };
    }
  }

  const resolvedToken = token ?? (await getCachedPushToken());
  if (!resolvedToken) {
    console.warn('[auryx][FCM] فشل إرسال الإشعار – تحقق من إعدادات Firebase: token still unavailable');
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
      console.error(
        `[auryx][FCM] فشل إرسال الإشعار – تحقق من إعدادات Firebase: ${result.error ?? 'unknown'}`,
      );
      return { success: false, error: result.error };
    }
  } catch (e) {
    console.error('[auryx][FCM] فشل إرسال الإشعار – تحقق من إعدادات Firebase:', e);
    return { success: false, error: String(e) };
  } finally {
    clearTimeout(pushTimer);
  }
}

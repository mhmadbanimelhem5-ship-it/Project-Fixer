/**
 * fcmService.ts
 *
 * Push notification service for Auryx.
 * Uses expo-notifications (Expo managed workflow) which routes through
 * Firebase Cloud Messaging (FCM) on Android and APNs on iOS.
 *
 * Flow:
 *   1. registerForPushNotifications() → requests OS permission + gets token
 *      └─ syncs the token to the server (/api/push/register) so the backend
 *         can send pushes later even when the app is closed (Absence Protocol).
 *   2. sendGuardianNotification()     → calls API server → Expo Push API → FCM
 *   3. debugPushRegistration()        → diagnostic path that surfaces silent
 *         failures as an on-screen Alert (one-shot, cheap retries).
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
import { getApiBase as getApiRoot } from './apiBase';

const PUSH_TOKEN_KEY = 'auryx_push_token_v1';
// Track whether we've already synced this exact token to avoid redundant network calls
const LAST_SYNCED_TOKEN_KEY = 'auryx_last_synced_push_token';

// Resolve the API server independently from the static Expo hosting domain.
function getApiBase(): string {
  return `${getApiRoot()}/api`;
}

/* ─── Server Sync Helper ───────────────────────────────────────────────────── */

/**
 * Sends the generated Expo push token to the backend so it can be stored in
 * the user_push_tokens table linked to the Clerk User ID.
 *
 * CRITICAL FOR SECURITY: Without this step, the Absence Scheduler (running via
 * Vercel Cron while the user's phone is locked/offline) has NO WAY to find the
 * user's device address. This function bridges that gap.
 *
 * Failures are logged but do NOT throw — losing a push sync must never break
 * the core vault experience or login flow. It degrades gracefully to email-only alerts.
 */
async function syncTokenToServer(token: string): Promise<void> {
  try {
    // Optimization: Don't re-sync if we know the server already has this exact token.
    // This saves battery/network on every single app open.
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
        platform: Platform.OS, // 'ios' | 'android'
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => String(response.status));
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    // Mark as successfully synced
    await SecureStore.setItemAsync(LAST_SYNCED_TOKEN_KEY, token);
    console.log('[auryx][FCM] ✅ Push token synced to server successfully');
  } catch (e) {
    // NON-FATAL ERROR: The app continues working perfectly without push sync.
    // We just log it so developers can debug connectivity issues later.
    console.warn('[auryx][FCM] ⚠️ Failed to sync push token to server (non-fatal):', e);
  }
}

/* ─── Token Registration ──────────────────────────────────────────────────── */

/**
 * Request OS permission for push notifications and obtain an Expo push token
 * (which wraps the underlying FCM registration token on Android).
 * Stores the token in SecureStore AND syncs it to the backend database.
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

    // 🔥 THE MOST IMPORTANT LINE IN THIS FILE 🔥
    // Sync to server immediately upon generation/update.
    // Fire-and-forget: we don't await blocking the UI thread unnecessarily,
    // but we DO initiate the background task safely.
    void syncTokenToServer(token);

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

/* ─── Diagnostic: surfaces silent registration failures on-screen ─────────── */
/**
 * Runs the entire registration pipeline step-by-step and returns a compact
 * report of exactly where it died (or succeeded). The hook calls this on
 * every launch; if it doesn't succeed, an Alert pops with the report, so the
 * failure is no longer silent — the user sees the exact broken step.
 *
 * Report format: "perm=granted > pid=18afbd16 > token=ExponentPushTok… > http=200"
 * or: "perm=granted > pid=18afbd16 > ERR=google-services.json not found"
 */
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
      // non-critical, continue
    }

    const response = await authenticatedFetch(`${getApiBase()}/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expoPushToken: token, platform: Platform.OS }),
    });
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
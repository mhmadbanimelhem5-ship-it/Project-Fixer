/**
 * useFirstLaunchPermissions
 *
 * Runs once per app installation (tracked via AsyncStorage):
 *   1. Push Notifications — needed for guardian alerts + absence protocol
 *   2. Camera — needed for the intruder-detection selfie feature
 *
 * PLUS (fix): a lightweight retry loop that guarantees the push token reaches
 * the server AFTER the user signs in. The one-shot registration used to fire
 * before the Clerk session existed, fail silently, and never retry — leaving
 * user_push_tokens empty forever. Registration is idempotent (server upserts;
 * fcmService skips re-syncing an already-synced token), so retrying is cheap.
 */

import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as ImagePicker from 'expo-image-picker';
import { registerForPushNotifications } from '@/utils/fcmService';

const PERMISSIONS_KEY = 'auryx_permissions_requested_v1';

export function useFirstLaunchPermissions(): void {
  // ── Effect 1: one-shot OS permission dialogs (behavior unchanged) ──────────
  useEffect(() => {
    if (Platform.OS === 'web') return;

    let cancelled = false;

    const requestAll = async () => {
      try {
        const alreadyRequested = await AsyncStorage.getItem(PERMISSIONS_KEY);
        if (alreadyRequested) return;

        // Mark as requested immediately so a crash doesn't re-trigger dialogs
        await AsyncStorage.setItem(PERMISSIONS_KEY, '1');

        if (cancelled) return;

        // ── 1. Notification permission ──────────────────────────────────────
        const { status: notifStatus } = await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
          },
        });

        if (notifStatus === 'granted') {
          await registerForPushNotifications();
        } else {
          console.warn('[auryx][Permissions] Notification permission denied:', notifStatus);
        }

        if (cancelled) return;

        // Small gap between dialogs so Android doesn't overlap them
        await new Promise<void>(r => setTimeout(r, 600));
        if (cancelled) return;

        // ── 2. Camera permission ────────────────────────────────────────────
        const { status: camStatus } = await ImagePicker.requestCameraPermissionsAsync();

        if (cancelled) return;

        if (camStatus !== 'granted') {
          Alert.alert(
            'إذن الكاميرا',
            'تحتاج Auryx إلى إذن الكاميرا لأخذ صورة للشخص الذي يحاول فتح خزنتك بعد محاولات كثيرة (ميزة "تصوير المتجسس").\n\nبدون هذا الإذن لن تعمل هذه الميزة الأمنية.\nيمكنك تفعيله لاحقاً من إعدادات الجهاز.',
            [
              { text: 'حسناً', style: 'default' },
            ],
          );
        }
      } catch (e) {
        // Never crash the app due to permission request failure
        console.warn('[auryx][Permissions] Failed during permission request:', e);
      }
    };

    // Delay 1.5s so the app UI is fully rendered before system dialogs appear
    const timer = setTimeout(requestAll, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // ── Effect 2 (THE FIX): guarantee token sync happens after sign-in ─────────
  // Runs on EVERY launch. Attempts registration shortly after start, then
  // retries every 20s while the app is open. Before sign-in the attempt fails
  // harmlessly; once a Clerk session exists, the next attempt succeeds and
  // fcmService's dedup makes every later attempt a cheap local no-op.
  useEffect(() => {
    if (Platform.OS === 'web') return;

    let stopped = false;

    const attempt = async () => {
      if (stopped) return;
      try {
        // Don't re-trigger system dialogs from here — only sync if allowed
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') return;
        await registerForPushNotifications();
      } catch (e) {
        // Silent by design: the next interval tick retries
      }
    };

    const first = setTimeout(attempt, 2500);
    const interval = setInterval(attempt, 20_000);

    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(interval);
    };
  }, []);
}
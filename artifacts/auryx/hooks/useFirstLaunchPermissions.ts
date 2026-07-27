/**
 * useFirstLaunchPermissions
 *
 * Runs once per app installation (tracked via AsyncStorage).
 * Requests OS-level permissions for:
 *   1. Push Notifications — needed for guardian alerts via FCM
 *   2. Camera — needed for the intruder-detection selfie feature
 *
 * If camera is denied, shows a clear explanation alert.
 * Also registers the device push token after permission is granted.
 */

import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as ImagePicker from 'expo-image-picker';
import { registerForPushNotifications } from '@/utils/fcmService';

const PERMISSIONS_KEY = 'auryx_permissions_requested_v1';

export function useFirstLaunchPermissions(): void {
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
        // iOS shows a system dialog; Android 13+ requires POST_NOTIFICATIONS
        const { status: notifStatus } = await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
          },
        });

        if (notifStatus === 'granted') {
          // Register for push immediately after permission is granted
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
          // Explain why camera is needed — user can grant later from Settings
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
}

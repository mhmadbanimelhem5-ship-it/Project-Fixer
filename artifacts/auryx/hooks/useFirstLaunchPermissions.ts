/**
 * useFirstLaunchPermissions
 *
 * Effect 1: OS permissions + local Expo token only (no API).
 * Effect 2: After clerkLoaded && isSignedIn, bounded ensures for server sync.
 */

import { useEffect, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as ImagePicker from 'expo-image-picker';
import { useAuth as useClerkAuth } from '@clerk/expo';
import { ensurePushTokenSynced, registerForPushNotifications } from '@/utils/fcmService';

const PERMISSIONS_KEY = 'auryx_permissions_requested_v1';

/** Single late backup if vault key-register path did not run. */
const ENSURE_BACKUP_DELAY_MS = 45_000;

export function useFirstLaunchPermissions(): void {
  const { isLoaded: clerkLoaded, isSignedIn } = useClerkAuth();
  const ensureStartedForSession = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    let cancelled = false;

    const requestAll = async () => {
      try {
        const alreadyRequested = await AsyncStorage.getItem(PERMISSIONS_KEY);
        if (alreadyRequested) return;

        await AsyncStorage.setItem(PERMISSIONS_KEY, '1');
        if (cancelled) return;

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
        await new Promise<void>((r) => setTimeout(r, 600));
        if (cancelled) return;

        const { status: camStatus } = await ImagePicker.requestCameraPermissionsAsync();
        if (cancelled) return;

        if (camStatus !== 'granted') {
          Alert.alert(
            'إذن الكاميرا',
            'تحتاج Auryx إلى إذن الكاميرا لأخذ صورة للشخص الذي يحاول فتح خزنتك بعد محاولات كثيرة (ميزة "تصوير المتجسس").\n\nبدون هذا الإذن لن تعمل هذه الميزة الأمنية.\nيمكنك تفعيله لاحقاً من إعدادات الجهاز.',
            [{ text: 'حسناً', style: 'default' }],
          );
        }
      } catch (e) {
        console.warn('[auryx][Permissions] Failed during permission request:', e);
      }
    };

    const timer = setTimeout(requestAll, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!clerkLoaded || !isSignedIn) {
      ensureStartedForSession.current = false;
      return;
    }

    if (ensureStartedForSession.current) return;
    ensureStartedForSession.current = true;

    let cancelled = false;
    // Primary sync is triggered after keys/register succeeds (vaultTransferApi).
    // This is only a late backup for sessions that never hit key registration.
    const timer = setTimeout(() => {
      if (cancelled) return;
      void ensurePushTokenSynced()
        .then((ok) => {
          if (ok) console.log('[auryx][Permissions] Push token ensured (backup)');
          else console.log('[auryx][Permissions] Push backup ensure not ready');
        })
        .catch((e) => console.warn('[auryx][Permissions] Push backup ensure failed:', e));
    }, ENSURE_BACKUP_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [clerkLoaded, isSignedIn]);
}

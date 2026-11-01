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

const ENSURE_DELAYS_MS = [1_000, 5_000, 15_000] as const;

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

    let stopped = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const runEnsure = async (attemptIndex: number) => {
      if (stopped) return;
      try {
        const ok = await ensurePushTokenSynced();
        if (ok) {
          stopped = true;
          console.log(`[auryx][Permissions] Push token ensured on attempt ${attemptIndex + 1}`);
        } else {
          console.log(
            `[auryx][Permissions] Push ensure attempt ${attemptIndex + 1}/${ENSURE_DELAYS_MS.length} not ready yet`,
          );
        }
      } catch (e) {
        console.warn('[auryx][Permissions] Push ensure failed:', e);
      }
    };

    ENSURE_DELAYS_MS.forEach((delay, index) => {
      timers.push(setTimeout(() => void runEnsure(index), delay));
    });

    return () => {
      stopped = true;
      timers.forEach(clearTimeout);
    };
  }, [clerkLoaded, isSignedIn]);
}

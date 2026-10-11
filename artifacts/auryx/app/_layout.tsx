// Polyfill must be the very first import so global.crypto.getRandomValues
// is available before any other module initialises. Wrapped in try/catch
// inside the file — a native crash here will not bring down the whole app.
import '@/setup/polyfill';

// ── Production console suppression ────────────────────────────────────────────
if (!__DEV__) {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const noop = () => {};
  console.log  = noop;
  console.warn = noop;
  console.info = noop;
  console.debug = noop;
}

import {
  Poppins_400Regular,
  Poppins_600SemiBold,
  Poppins_700Bold,
  useFonts,
} from '@expo-google-fonts/poppins';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Platform, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClerkLoaded, ClerkProvider, useAuth as useClerkAuth, useUser } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';
import Purchases from 'react-native-purchases';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AnimatedSplash } from '@/components/AnimatedSplash';
import { OfflineScreen } from '@/components/OfflineScreen';
import { OfflineBanner } from '@/components/OfflineBanner';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { VaultProvider, useVault } from '@/contexts/VaultContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { NetworkProvider, useNetwork } from '@/contexts/NetworkContext';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { useFirstLaunchPermissions } from '@/hooks/useFirstLaunchPermissions';
import { isSubtleAvailable } from '@/utils/cryptoFallback';
import { setAuthenticatedTokenGetter } from '@/utils/authenticatedFetch';
import { getApiBase } from '@/utils/apiBase';

SplashScreen.preventAutoHideAsync();

let clerkDiagnosticsLogged = false;

(function checkCryptoEngine() {
  try {
    const subtle = isSubtleAvailable();
    const engine = subtle ? 'crypto.subtle (native Hermes)' : 'node-forge (pure-JS fallback)';
    console.info(`[Auryx] Crypto engine: ${engine}`);
    if (!subtle) {
      console.warn(
        '[Auryx] crypto.subtle not available on this device/runtime. ' +
        'RSA operations will use the node-forge fallback (slower but correct). ' +
        'This is expected on Android < RN 0.74, custom ROMs, or JSC engine builds.',
      );
    }
  } catch (e) {
    console.error('[Auryx] Crypto engine check failed:', e);
  }
})();

const queryClient = new QueryClient();

function OfflineGate() {
  const { isConnected, isChecking, offlineMode } = useNetwork();
  if (isChecking || isConnected || offlineMode) return null;
  return <OfflineScreen />;
}

function VaultLoadingOverlay() {
  const { isVaultReady, vaultLoadPhase } = useVault();
  const { isLocked } = useAuth();
  const { colors: c } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);
  const [displayPhase, setDisplayPhase] = useState('جارٍ تحميل الخزنة…');
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (vaultLoadPhase) setDisplayPhase(vaultLoadPhase);
  }, [vaultLoadPhase]);

  useEffect(() => {
    if (!isLocked && !isVaultReady) {
      setDisplayPhase('جارٍ تحميل الخزنة…');
      setVisible(true);
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    } else if (isVaultReady) {
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setVisible(false);
      });
    }
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [isLocked, isVaultReady]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 9996,
        backgroundColor: c.background,
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
      }}
    >
      <ActivityIndicator size="large" color="#D4AF37" />
      <Text style={{ color: '#D4AF37', fontSize: 14, fontFamily: 'Poppins_600SemiBold', marginTop: 16 }}>
        {displayPhase}
      </Text>
    </Animated.View>
  );
}

function KeyGeneratingOverlay() {
  const { isKeyGenerating, keyError, keyErrorMsg, retryKeyGeneration, keyGenProgress, keyGenPhase } = useVault();
  useTheme();
  const opacity   = useRef(new Animated.Value(0)).current;
  const barAnim   = useRef(new Animated.Value(0)).current;
  const [elapsed, setElapsed]   = useState(0);
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const usingNative = isSubtleAvailable();

  useEffect(() => {
    Animated.timing(barAnim, {
      toValue: keyGenProgress,
      duration: 600,
      useNativeDriver: false,
    }).start();
  }, [keyGenProgress]);

  useEffect(() => {
    if (isKeyGenerating) {
      setElapsed(0);
      barAnim.setValue(0);
      Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }).start();
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    } else {
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }).start();
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [isKeyGenerating]);

  if (!isKeyGenerating && !keyError) return null;

  const elapsedStr = elapsed >= 60
    ? `${Math.floor(elapsed / 60)}د ${elapsed % 60}ث`
    : `${elapsed}ث`;

  return (
    <Animated.View
      pointerEvents="auto"
      style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 9997,
        backgroundColor: 'rgba(5,8,20,0.97)',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        opacity,
      }}
    >
      {keyError ? (
        <View style={{ alignItems: 'center', gap: 16, width: '100%' }}>
          <View style={{
            width: 64, height: 64, borderRadius: 32,
            backgroundColor: 'rgba(239,68,68,0.15)',
            borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: '#EF4444', fontSize: 28 }}>!</Text>
          </View>
          <Text style={{ color: '#EF4444', fontSize: 16, fontFamily: 'Poppins_700Bold', textAlign: 'center' }}>
            فشل توليد مفاتيح التشفير
          </Text>
          <Text style={{ color: '#64748B', fontSize: 13, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22 }}>
            {keyErrorMsg}
          </Text>
          <TouchableOpacity
            onPress={() => retryKeyGeneration()}
            style={{
              backgroundColor: 'rgba(212,175,55,0.15)',
              borderWidth: 1, borderColor: 'rgba(212,175,55,0.4)',
              borderRadius: 12, paddingVertical: 12, paddingHorizontal: 32,
              marginTop: 8,
            }}
          >
            <Text style={{ color: '#D4AF37', fontSize: 14, fontFamily: 'Poppins_600SemiBold' }}>
              إعادة المحاولة
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{ alignItems: 'center', gap: 24, width: '100%' }}>
          <View style={{
            width: 72, height: 72, borderRadius: 36,
            backgroundColor: 'rgba(212,175,55,0.08)',
            borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 30 }}>🔐</Text>
          </View>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text style={{ color: '#D4AF37', fontSize: 18, fontFamily: 'Poppins_700Bold', textAlign: 'center' }}>
              جارٍ تهيئة مفاتيح التشفير
            </Text>
            <Text style={{ color: '#64748B', fontSize: 12, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 20 }}>
              يتم إنشاء مفاتيح RSA لحماية خزنتك{'\n'}يحدث هذا مرةً واحدة فقط عند التثبيت
            </Text>
          </View>
          <View style={{ width: '100%', gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: '#94A3B8', fontSize: 12, fontFamily: 'Poppins_400Regular' }}>
                {keyGenPhase || 'جارٍ التوليد…'}
              </Text>
              <Text style={{ color: '#D4AF37', fontSize: 16, fontFamily: 'Poppins_700Bold' }}>
                {keyGenProgress}%
              </Text>
            </View>
            <View style={{
              width: '100%', height: 8, borderRadius: 4,
              backgroundColor: 'rgba(255,255,255,0.06)',
              overflow: 'hidden',
            }}>
              <Animated.View style={{
                height: '100%',
                borderRadius: 4,
                backgroundColor: '#D4AF37',
                width: barAnim.interpolate({
                  inputRange: [0, 100],
                  outputRange: ['0%', '100%'],
                  extrapolate: 'clamp',
                }),
                shadowColor: '#D4AF37',
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.6,
                shadowRadius: 4,
              }} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <View style={{
              backgroundColor: usingNative ? 'rgba(34,197,94,0.1)' : 'rgba(212,175,55,0.1)',
              borderWidth: 1,
              borderColor: usingNative ? 'rgba(34,197,94,0.3)' : 'rgba(212,175,55,0.2)',
              borderRadius: 20, paddingVertical: 4, paddingHorizontal: 10,
            }}>
              <Text style={{
                color: usingNative ? '#22C55E' : '#D4AF37',
                fontSize: 11, fontFamily: 'Poppins_600SemiBold',
              }}>
                {usingNative ? '⚡ محرك أصلي' : '⏳ محرك بديل'}
              </Text>
            </View>
            <Text style={{ color: '#475569', fontSize: 12, fontFamily: 'Poppins_400Regular' }}>
              {elapsedStr} مضت
            </Text>
          </View>
          <Text style={{ color: '#334155', fontSize: 11, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 18 }}>
            لا تغلق التطبيق — العملية جارية في الخلفية
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

function RootLayoutNav() {
  const { isLocked, isSetup, vaultKey, isDecoyMode } = useAuth();
  const { isLoaded: clerkLoaded, isSignedIn, getToken } = useClerkAuth();
  const { user } = useUser();
  const { loadVault, loadDecoyVault, lockVaultSession, isVaultReady, legacy } = useVault();
  const { colors: c } = useTheme();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (!clerkLoaded) return;
    const syncRevenueCatIdentity = async () => {
      try {
        if (isSignedIn && user?.id) {
          await Purchases.logIn(user.id);
          console.log('[Auryx][RevenueCat] Identity synced:', user.id);
        } else {
          await Purchases.logOut();
          console.log('[Auryx][RevenueCat] Logged out (anonymous mode)');
        }
      } catch (error) {
        console.error('[Auryx][RevenueCat] Identity sync failed:', error);
      }
    };
    syncRevenueCatIdentity();
  }, [clerkLoaded, isSignedIn, user?.id]);

  useEffect(() => {
    if (!clerkLoaded) return;
    const getApiAuthToken = async () => {
      try {
        const token = await getToken();
        console.log(`[Auryx][Auth] getToken=${token ? `present(length=${token.length})` : 'null'} signedIn=${isSignedIn}`);
        return token;
      } catch (error) {
        console.warn('[Auryx][Auth] getToken failed:', error instanceof Error ? error.message : 'unknown_error');
        throw error;
      }
    };
    setAuthenticatedTokenGetter(getApiAuthToken);
    setAuthTokenGetter(getApiAuthToken);
    console.log(`[Auryx][Auth] token bridge ready signedIn=${isSignedIn}`);
    return () => {
      setAuthenticatedTokenGetter(null);
      setAuthTokenGetter(null);
    };
  }, [clerkLoaded, getToken, isSignedIn]);

  useEffect(() => {
    if (isLocked) {
      lockVaultSession();
      return;
    }
    if (isDecoyMode) {
      if (vaultKey) loadDecoyVault(vaultKey);
    } else {
      if (vaultKey) loadVault(vaultKey);
    }
  }, [isLocked, isDecoyMode, vaultKey]);

  useEffect(() => {
    if (!clerkLoaded) return;
    const inAuth = segments[0] === '(auth)';
    if (!isSignedIn) {
      if (!inAuth) router.replace('/sign-in');
      return;
    }
    if (inAuth) {
      router.replace('/lock');
      return;
    }
    const inLock       = segments[0] === 'lock';
    const inOnboarding = segments[0] === 'onboarding';
    const inPinReset   = segments[0] === 'pin-reset'; // ← السماح بالوصول لشاشة الاستعادة أثناء القفل

    if (isLocked || !isSetup) {
      // ✅ التعديل: السماح بالبقاء في lock أو pin-reset
      if (!inLock && !inPinReset) router.replace('/lock');
      return;
    }
    if (!isVaultReady) {
      if (inLock) router.replace('/(tabs)');
      return;
    }
    if (!isDecoyMode && !legacy.ownerName) {
      if (!inOnboarding) router.replace('/onboarding');
      return;
    }
    if (inLock) router.replace('/(tabs)');
  }, [clerkLoaded, isSignedIn, isLocked, isSetup, isVaultReady, isDecoyMode, legacy.ownerName, segments]);

  useFirstLaunchPermissions();

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }}>
      <Stack.Screen name="(auth)"        options={{ headerShown: false }} />
      <Stack.Screen name="lock"          options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="onboarding"    options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="(tabs)"        options={{ headerShown: false }} />
      <Stack.Screen name="emergency"     options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="legacy"        options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="received-vault" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="pin-reset"     options={{ headerShown: false, presentation: 'card' }} />
    </Stack>
  );
}

function ThemedContainer({ children, showSplash, onSplashComplete }: {
  children: React.ReactNode;
  showSplash: boolean;
  onSplashComplete: () => void;
}) {
  const { isDark, colors: c } = useTheme();
  const [touchWarn, setTouchWarn] = React.useState(false);
  const touchWarnTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (touchWarnTimerRef.current) clearTimeout(touchWarnTimerRef.current); }, []);

  const handleSafetyFired = React.useCallback(() => {
    console.warn('[Auryx] AnimatedSplash completed via safety timer — possible frame-drop or native animation interruption on this device.');
    setTouchWarn(true);
    if (touchWarnTimerRef.current) clearTimeout(touchWarnTimer.current);
    touchWarnTimerRef.current = setTimeout(() => setTouchWarn(false), 4000);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardProvider statusBarTranslucent>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        {children}
        <OfflineBanner />
        <OfflineGate />
        <VaultLoadingOverlay />
        <KeyGeneratingOverlay />
        {showSplash && (
          <AnimatedSplash onComplete={onSplashComplete} onSafetyTimerFired={handleSafetyFired} />
        )}
        {touchWarn && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', bottom: 80, left: 20, right: 20, zIndex: 9998,
              backgroundColor: 'rgba(180,60,0,0.95)', borderRadius: 10,
              paddingHorizontal: 16, paddingVertical: 10,
              borderWidth: 1, borderColor: 'rgba(255,150,0,0.5)',
              pointerEvents: 'none',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 12, fontFamily: 'Poppins_400Regular', textAlign: 'center' }}>
              {'تم تعطيل طبقة الخلفية، الرجاء إعادة المحاولة'}
            </Text>
          </View>
        )}
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function StartupConfigurationError({ message }: { message: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: '#0A0F1E', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
      <Text style={{ color: '#D4AF37', fontSize: 24, fontWeight: '700', textAlign: 'center', marginBottom: 16 }}>
        تعذر تشغيل Auryx
      </Text>
      <Text style={{ color: '#CBD5E1', fontSize: 15, lineHeight: 25, textAlign: 'center' }}>
        نسخة التطبيق لا تحتوي على إعداد Clerk العام المطلوب.
      </Text>
      <Text selectable style={{ color: '#64748B', fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 18 }}>
        {message}
      </Text>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });
  const [timedOut, setTimedOut]   = useState(false);
  const [showSplash, setShowSplash] = useState(Platform.OS !== 'web');
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    const initRevenueCat = async () => {
      try {
        const REVENUECAT_ANDROID_KEY = 'goog_wajUnLGEWgHKKevsbPZauLuQGeo'; 
        Purchases.configure({ apiKey: REVENUECAT_ANDROID_KEY });
        console.log('✅ RevenueCat Initialized Successfully');
      } catch (error) {
        console.error('❌ Failed to initialize RevenueCat:', error);
      }
    };
    initRevenueCat();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError || timedOut) {
      SplashScreen.hideAsync();
      setFontsReady(true);
    }
  }, [fontsLoaded, fontError, timedOut]);

  if (!fontsReady) return null;

  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || '';
  if (!clerkDiagnosticsLogged) {
    const clerkKeyMode = publishableKey.startsWith('pk_live_')
      ? 'live'
      : publishableKey.startsWith('pk_test_')
        ? 'test'
        : 'unknown';
    console.log('[Auryx][Clerk] configuration', { clerkKeyMode, clerkConfigured: Boolean(publishableKey) });
    clerkDiagnosticsLogged = true;
  }
  if (!publishableKey) {
    return <StartupConfigurationError message="Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY" />;
  }
  setBaseUrl(getApiBase());

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache} proxyUrl={process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined}>
          <ClerkLoaded>
            <QueryClientProvider client={queryClient}>
              <NetworkProvider>
                <ThemeProvider>
                  <LanguageProvider>
                    <AuthProvider>
                      <VaultProvider>
                        <NotificationProvider>
                          <ThemedContainer showSplash={showSplash} onSplashComplete={() => setShowSplash(false)}>
                            <RootLayoutNav />
                          </ThemedContainer>
                        </NotificationProvider>
                      </VaultProvider>
                    </AuthProvider>
                  </LanguageProvider>
                </ThemeProvider>
              </NetworkProvider>
            </QueryClientProvider>
          </ClerkLoaded>
        </ClerkProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
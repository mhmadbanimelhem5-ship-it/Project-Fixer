// Polyfill must be the very first import so global.crypto.getRandomValues
// is available before any other module initialises. Wrapped in try/catch
// inside the file — a native crash here will not bring down the whole app.
import '@/setup/polyfill';

// ── Production console suppression ────────────────────────────────────────────
// console.log/warn/info are synchronous on Hermes and measurably slow the JS
// thread in production APKs. Suppress them completely in release builds.
// console.error is kept so crash reporters / error boundaries can still surface
// critical failures.
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
import { ActivityIndicator, Animated, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClerkLoaded, ClerkProvider, useAuth as useClerkAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';
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

// ─── Crypto engine diagnostic (runs once on cold start) ───────────────────────
// Logs which RSA engine is active so post-build issues are immediately visible.
// Safe: no secrets, no side effects — read-only availability check.
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

// ─── Offline gate ─────────────────────────────────────────────────────────────
function OfflineGate() {
  const { isConnected, isChecking, offlineMode } = useNetwork();
  // Pass through if: still checking, already connected, or user chose offline mode
  if (isChecking || isConnected || offlineMode) return null;
  return <OfflineScreen />;
}

// ─── Navigation stack ─────────────────────────────────────────────────────────

// ─── Vault loading overlay ─────────────────────────────────────────────────────
// Shown briefly after PIN unlock while the vault loads from storage.
// Prevents blank-screen flash during the 200–500 ms loadVault awaits.
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
    // Show overlay when unlocked but vault not ready yet
    if (!isLocked && !isVaultReady) {
      setDisplayPhase('جارٍ تحميل الخزنة…');
      setVisible(true);
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    } else if (isVaultReady) {
      // Fade out once vault is ready
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

// ─── Key generation overlay ────────────────────────────────────────────────────
// Shown when RSA keys are being generated on first install only.
// Shows a real animated progress bar (0–100 %) sourced from the actual key-gen
// callback so the user always knows exactly how far along the process is.
function KeyGeneratingOverlay() {
  const { isKeyGenerating, keyError, keyErrorMsg, retryKeyGeneration, keyGenProgress, keyGenPhase } = useVault();
  useTheme();
  const opacity   = useRef(new Animated.Value(0)).current;
  const barAnim   = useRef(new Animated.Value(0)).current;
  const [elapsed, setElapsed]   = useState(0);
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const usingNative = isSubtleAvailable();

  // Animate the progress bar width smoothly whenever keyGenProgress changes
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
        /* ── Error state ──────────────────────────────────────────────────── */
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
        /* ── Progress state ───────────────────────────────────────────────── */
        <View style={{ alignItems: 'center', gap: 24, width: '100%' }}>

          {/* Lock icon */}
          <View style={{
            width: 72, height: 72, borderRadius: 36,
            backgroundColor: 'rgba(212,175,55,0.08)',
            borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 30 }}>🔐</Text>
          </View>

          {/* Title */}
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text style={{ color: '#D4AF37', fontSize: 18, fontFamily: 'Poppins_700Bold', textAlign: 'center' }}>
              جارٍ تهيئة مفاتيح التشفير
            </Text>
            <Text style={{ color: '#64748B', fontSize: 12, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 20 }}>
              يتم إنشاء مفاتيح RSA لحماية خزنتك{'\n'}يحدث هذا مرةً واحدة فقط عند التثبيت
            </Text>
          </View>

          {/* Progress percentage + bar */}
          <View style={{ width: '100%', gap: 10 }}>
            {/* Percentage row */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: '#94A3B8', fontSize: 12, fontFamily: 'Poppins_400Regular' }}>
                {keyGenPhase || 'جارٍ التوليد…'}
              </Text>
              <Text style={{ color: '#D4AF37', fontSize: 16, fontFamily: 'Poppins_700Bold' }}>
                {keyGenProgress}%
              </Text>
            </View>

            {/* Progress bar track */}
            <View style={{
              width: '100%', height: 8, borderRadius: 4,
              backgroundColor: 'rgba(255,255,255,0.06)',
              overflow: 'hidden',
            }}>
              {/* Animated fill */}
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

          {/* Elapsed time + engine badge */}
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

          {/* Reassurance note */}
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
  const { loadVault, loadDecoyVault, lockVaultSession, isVaultReady, legacy } = useVault();
  const { colors: c } = useTheme();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    setAuthenticatedTokenGetter(() => getToken());
    setAuthTokenGetter(() => getToken());
    return () => {
      setAuthenticatedTokenGetter(null);
      setAuthTokenGetter(null);
    };
  }, [getToken]);

  // Unified effect: sync auth state → vault content
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

  // Navigation guard
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

    if (isLocked || !isSetup) {
      if (!inLock) router.replace('/lock');
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
    // Onboarding navigates itself to /(tabs) via its own useEffect once
    // ownerName is set.  Do NOT also navigate here — two simultaneous
    // router.replace calls in the same React commit cause undefined behavior
    // in Expo Router on Android/Hermes.
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
    </Stack>
  );
}

// ─── Themed container — reads theme and applies background ────────────────────
function ThemedContainer({ children, showSplash, onSplashComplete }: {
  children: React.ReactNode;
  showSplash: boolean;
  onSplashComplete: () => void;
}) {
  const { isDark, colors: c } = useTheme();
  const [touchWarn, setTouchWarn] = React.useState(false);
  const touchWarnTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (touchWarnTimerRef.current) clearTimeout(touchWarnTimerRef.current); }, []);

  // Show a brief diagnostic banner when the safety timer fires instead of the
  // normal animation path. This indicates a background layer may have delayed
  // completion on this device (logged as a warning, auto-dismissed after 4 s).
  const handleSafetyFired = React.useCallback(() => {
    console.warn('[Auryx] AnimatedSplash completed via safety timer — possible frame-drop or native animation interruption on this device.');
    setTouchWarn(true);
    if (touchWarnTimerRef.current) clearTimeout(touchWarnTimerRef.current);
    touchWarnTimerRef.current = setTimeout(() => setTouchWarn(false), 4000);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardProvider statusBarTranslucent>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        {children}

        {/* Layer 0 (zIndex 9990): offline mode banner — visible when browsing offline */}
        <OfflineBanner />

        {/* Layer 1 (zIndex 9998): offline wall */}
        <OfflineGate />

        {/* Layer 1.5 (zIndex 9996): vault loading overlay — brief after PIN unlock */}
        <VaultLoadingOverlay />

        {/* Layer 2 (zIndex 9997): key generation progress toast */}
        <KeyGeneratingOverlay />

        {/* Layer 3 (zIndex 9999): animated splash */}
        {showSplash && (
          <AnimatedSplash onComplete={onSplashComplete} onSafetyTimerFired={handleSafetyFired} />
        )}

        {/* Diagnostic banner — shown briefly if safety timer fired (layer blocking suspected) */}
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

/**
 * Render a useful message when a release build is missing a public runtime
 * setting. This must stay outside the provider tree: throwing here would
 * terminate Android before ErrorBoundary can render anything.
 */
function StartupConfigurationError({ message }: { message: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#0A0F1E',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 28,
      }}
    >
      <Text
        style={{
          color: '#D4AF37',
          fontSize: 24,
          fontWeight: '700',
          textAlign: 'center',
          marginBottom: 16,
        }}
      >
        تعذر تشغيل Auryx
      </Text>
      <Text style={{ color: '#CBD5E1', fontSize: 15, lineHeight: 25, textAlign: 'center' }}>
        نسخة التطبيق لا تحتوي على إعداد Clerk العام المطلوب.
      </Text>
      <Text
        selectable
        style={{
          color: '#64748B',
          fontSize: 12,
          lineHeight: 19,
          textAlign: 'center',
          marginTop: 18,
        }}
      >
        {message}
      </Text>
    </View>
  );
}

// ─── Root layout ──────────────────────────────────────────────────────────────

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });
  const [timedOut, setTimedOut]   = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [fontsReady, setFontsReady] = useState(false);

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

  // Local/Replit builds map CLERK_PUBLISHABLE_KEY into the public Expo
  // variable. Keeping the second read here also makes a locally generated
  // native APK start correctly when Metro receives the workspace secret
  // directly. The secret Clerk key is intentionally never read.
  const publishableKey =
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ||
    process.env.CLERK_PUBLISHABLE_KEY?.trim();
  if (!publishableKey) {
    return (
      <StartupConfigurationError message="Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY" />
    );
  }
  setBaseUrl(getApiBase());

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <ClerkProvider
          publishableKey={publishableKey}
          tokenCache={tokenCache}
          proxyUrl={process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined}
        >
          <ClerkLoaded>
            <QueryClientProvider client={queryClient}>
              <NetworkProvider>
                <ThemeProvider>
                  <LanguageProvider>
                    <AuthProvider>
                      <VaultProvider>
                        <NotificationProvider>
                          <ThemedContainer
                            showSplash={showSplash}
                            onSplashComplete={() => setShowSplash(false)}
                          >
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

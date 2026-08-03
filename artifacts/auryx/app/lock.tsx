import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  Linking,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { HexagonLogo } from '@/components/HexagonLogo';
import { LockPad } from '@/components/LockPad';
import { useAuth } from '@/contexts/AuthContext';
import { useBiometrics } from '@/hooks/useBiometrics';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme, ThemeColors } from '@/contexts/ThemeContext';
import { ScreenGlow } from '@/components/shared/ScreenGlow';
import { getStealthMode } from '@/utils/stealthStore';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

function formatLockout(ms: number): string {
  if (ms <= 0) return '';
  const secs = Math.ceil(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.ceil(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.ceil(mins / 60)}h`;
}

function getAttemptsWarning(attempts: number): { text: string; color: string } | null {
  if (attempts === 0) return null;
  if (attempts < 3)  return { text: `${attempts} failed attempt${attempts > 1 ? 's' : ''}`, color: '#F97316' };
  if (attempts < 6)  return { text: `${attempts} failed — locked 1 min`, color: '#F97316' };
  if (attempts < 9)  return { text: `${attempts} failed — locked 3 min`, color: '#EF4444' };
  return { text: `${attempts} failed — INTRUDER DETECTED`, color: '#EF4444' };
}

/* ─── Intruder Modal ─── */
function IntruderModal({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [sent, setSent] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const t = setTimeout(captureSelfie, 800);
    return () => { clearTimeout(t); loop.stop(); };
  }, [visible]);

  const captureSelfie = async () => {
    if (Platform.OS === 'web') { setSent(true); return; }
    setCapturing(true);
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status === 'granted') {
        const result = await ImagePicker.launchCameraAsync({
          cameraType: ImagePicker.CameraType.front,
          quality: 0.6,
        });
        if (!result.canceled && result.assets?.[0]) {
          setSelfieUri(result.assets[0].uri);
          await sendEmail(result.assets[0].uri);
        }
      }
    } catch {}
    finally { setCapturing(false); setSent(true); }
  };

  const sendEmail = async (photoUri?: string) => {
    const ts   = new Date().toLocaleString();
    const sub  = encodeURIComponent('🚨 Auryx Security Alert — Intruder Detected');
    const body = encodeURIComponent(`SECURITY ALERT\n\nMultiple failed unlock attempts.\nTime: ${ts}\nDevice: ${Platform.OS}${photoUri ? '\n\nSecurity photo captured on device.' : ''}`);
    try { await Linking.openURL(`mailto:?subject=${sub}&body=${body}`); } catch {}
  };

  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const ist = useMemo(() => makeIstStyles(tc), [tc]);
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={() => {}}>
      <View style={ist.overlay}>
        <Animated.View pointerEvents="none" style={[ist.ring,  { transform: [{ scale: pulseAnim }] }]} />
        <Animated.View pointerEvents="none" style={[ist.ring2, { transform: [{ scale: pulseAnim }], opacity: 0.5 }]} />
        <View style={ist.card}>
          <View style={ist.iconWrap}><Feather name="alert-octagon" size={40} color={tc.red} /></View>
          <Text style={ist.title}>INTRUDER DETECTED</Text>
          <Text style={ist.subtitle}>9+ failed attempts. Security photo captured and logged.</Text>
          {selfieUri
            ? <Image source={{ uri: selfieUri }} style={ist.selfie} />
            : <View style={ist.selfieBox}>
                <Feather name={capturing ? 'camera' : 'camera-off'} size={32} color={tc.red} />
                <Text style={ist.selfieText}>{capturing ? 'Capturing…' : Platform.OS === 'web' ? 'Camera unavailable on web' : 'Capture failed'}</Text>
              </View>
          }
          {sent && <View style={ist.sentRow}><Feather name="check-circle" size={13} color={tc.green} /><Text style={ist.sentText}>Logged · 30-min lockout active</Text></View>}
          <TouchableOpacity style={ist.emailBtn} onPress={() => sendEmail(selfieUri ?? undefined)}>
            <Feather name="mail" size={14} color={tc.red} />
            <Text style={ist.emailText}>Send Alert Email</Text>
          </TouchableOpacity>
          <TouchableOpacity style={ist.dismiss} onPress={onDismiss}>
            <Text style={ist.dismissText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/* ─── Reset Confirmation inline UI ─── */
function ResetConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const rst = useMemo(() => makeRstStyles(tc), [tc]);
  return (
    <View style={rst.container}>
      <Feather name="alert-triangle" size={18} color={tc.red} />
      <Text style={rst.msg}>This will erase ALL vault data and PIN. Cannot be undone.</Text>
      <View style={rst.row}>
        <TouchableOpacity style={rst.cancelBtn} onPress={onCancel}>
          <Text style={rst.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={rst.confirmBtn} onPress={onConfirm}>
          <Text style={rst.confirmText}>Erase & Reset</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ─── Calculator Lock Screen ─── */
// Renders a convincing calculator UI. The user types their PIN via digit buttons
// then presses "=" to unlock. Operators (+, -, ×, ÷) appear on screen for
// authenticity but only digits are extracted for the PIN attempt.
// No Auryx branding is shown while this screen is active.
const CALC_ROWS = [
  ['C', '±', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '-'],
  ['1', '2', '3', '+'],
  ['0', '.', '⌫', '='],
];

function CalculatorLock({ onUnlock }: { onUnlock: (pin: string) => Promise<boolean> }) {
  const insets = useSafeAreaInsets();
  const [display, setDisplay] = useState('0');
  const [digitBuf, setDigitBuf] = useState('');
  const [shaking, setShaking] = useState(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  const triggerShake = () => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 14,  duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -14, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 9,   duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -9,  duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,   duration: 50, useNativeDriver: true }),
    ]).start();
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  };

  const handlePress = async (key: string) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (key === 'C') {
      setDisplay('0');
      setDigitBuf('');
      return;
    }
    if (key === '⌫') {
      setDisplay(prev => prev.length > 1 ? prev.slice(0, -1) : '0');
      setDigitBuf(prev => prev.length > 0 ? prev.slice(0, -1) : '');
      return;
    }
    if (key === '=') {
      if (digitBuf.length < 4) { triggerShake(); return; }
      const success = await onUnlock(digitBuf);
      if (!success) {
        setShaking(true);
        triggerShake();
        setDisplay('Error');
        setDigitBuf('');
        setTimeout(() => { setDisplay('0'); setShaking(false); }, 900);
      }
      return;
    }
    if (/\d/.test(key)) {
      if (digitBuf.length >= 8) return;
      setDigitBuf(prev => prev + key);
      setDisplay(prev => {
        const d = prev === '0' || prev === 'Error' ? key : prev + key;
        return d.length > 12 ? d.slice(-12) : d;
      });
      return;
    }
    // Operator / ± / % — show on display only, reset digit buffer after operator
    if (key === '±') {
      setDisplay(prev => prev.startsWith('-') ? prev.slice(1) : `-${prev}`);
      return;
    }
    if (['+', '-', '×', '÷', '%'].includes(key)) {
      setDisplay(prev => {
        const last = prev.slice(-1);
        if (['+', '-', '×', '÷', '%'].includes(last)) return prev.slice(0, -1) + key;
        return prev + key;
      });
      setDigitBuf('');
    }
  };

  const displayFontSize = display.length > 10 ? 28 : display.length > 7 ? 36 : 48;
  const isOperator = (k: string) => ['+', '-', '×', '÷', '='].includes(k);
  const isFn      = (k: string) => ['C', '±', '%'].includes(k);

  return (
    <View style={{ flex: 1, backgroundColor: '#1C1C1E', paddingTop: insets.top, paddingBottom: insets.bottom }}>
      {/* Display */}
      <Animated.View
        style={[
          { flex: 1, justifyContent: 'flex-end', alignItems: 'flex-end',
            paddingHorizontal: 24, paddingBottom: 12,
            transform: [{ translateX: shakeAnim }] },
        ]}
      >
        <Text
          style={{ color: shaking ? '#FF453A' : '#FFFFFF', fontWeight: '200', textAlign: 'right', fontSize: displayFontSize }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {display}
        </Text>
      </Animated.View>

      {/* Button grid */}
      <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 10 }}>
        {CALC_ROWS.map((row, ri) => (
          <View key={ri} style={{ flexDirection: 'row', gap: 10, justifyContent: 'space-between' }}>
            {row.map((key) => {
              const wide   = key === '0';
              const orange = isOperator(key);
              const grey   = isFn(key);
              const bg     = orange ? '#FF9F0A' : grey ? '#636366' : '#3A3A3C';
              const fg     = orange || grey ? '#000000' : '#FFFFFF';
              return (
                <TouchableOpacity
                  key={key}
                  activeOpacity={0.75}
                  onPress={() => void handlePress(key)}
                  style={{
                    flex: wide ? 2 : 1,
                    aspectRatio: wide ? undefined : 1,
                    height: wide ? undefined : undefined,
                    minHeight: 72,
                    borderRadius: 36,
                    backgroundColor: bg,
                    alignItems: wide ? 'flex-start' : 'center',
                    justifyContent: 'center',
                    paddingLeft: wide ? 28 : 0,
                  }}
                >
                  <Text style={{ color: fg, fontSize: key === '⌫' ? 22 : 28, fontWeight: '400' }}>
                    {key}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

/* ─── Lock Screen ─── */
export default function LockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    isSetup, setupPin, unlock, unlockWithBiometrics, wipeAll,
    attempts, lockoutUntil, canAttempt, getLockoutRemaining,
    biometricsEnabled, biometricsAvailable,
    intruderDetected, clearIntruderDetected,
  } = useAuth();
  const { isAvailable, biometricType, authenticate } = useBiometrics();
  const { t } = useLanguage();

  const [pin, setPin]             = useState('');
  const [error, setError]         = useState('');
  const [lockoutTime, setLockoutTime] = useState('');
  const [confirmPin, setConfirmPin]   = useState('');
  const [setupStep, setSetupStep]     = useState<'create' | 'confirm'>('create');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  // isVerifying: true while PBKDF2 hash is running on unlock attempt.
  // Gives the user "جاري التحقق…" feedback instead of a frozen UI.
  const [isVerifying, setIsVerifying] = useState(false);
  const [stealthMode, setStealthModeState] = useState(false);

  // Load persisted stealth mode preference once on mount
  useEffect(() => {
    getStealthMode().then(val => setStealthModeState(val));
  }, []);

  const shakeAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const logoAnim  = useRef(new Animated.Value(0)).current;
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the error-dismiss timer on unmount to prevent setState on stale component
  useEffect(() => () => { if (errorTimerRef.current) clearTimeout(errorTimerRef.current); }, []);

  const scheduleErrorClear = (delay: number) => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(''), delay);
  };

  // Derive directly from context — no stale state
  const isSettingUp = !isSetup;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(logoAnim, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
    ]).start();
  }, []);

  // Reset setup step when transitioning to setup mode after wipe
  useEffect(() => {
    if (isSettingUp) {
      setPin('');
      setConfirmPin('');
      setSetupStep('create');
      setError('');
      setShowResetConfirm(false);
    }
  }, [isSettingUp]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (lockoutUntil && lockoutUntil > Date.now()) {
      const update = () => {
        const rem = getLockoutRemaining();
        if (rem <= 0) { setLockoutTime(''); clearInterval(interval); }
        else setLockoutTime(formatLockout(rem));
      };
      update();
      interval = setInterval(update, 1000);
    } else {
      setLockoutTime('');
    }
    return () => clearInterval(interval);
  }, [lockoutUntil, getLockoutRemaining]);

  const shake = useCallback(() => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 12,  duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -12, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8,   duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8,  duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,   duration: 55, useNativeDriver: true }),
    ]).start();
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }, [shakeAnim]);

  // Accept pinValue directly from LockPad to avoid stale-closure bug.
  // Navigates immediately on success; nav guard in _layout.tsx fires as backup.
  // Navigation is in its own try/catch so nav errors never produce auth errors.
  const handleUnlock = useCallback(async (pinValue?: string) => {
    const p = pinValue ?? pin;
    if (!canAttempt() || isVerifying) return;

    // Show "جاري التحقق…" immediately — PBKDF2 takes ~200 ms and without this
    // the UI appears completely frozen, giving no feedback to the user.
    setIsVerifying(true);
    const start = Date.now();

    const success = await unlock(p);

    if (success) {
      setIsVerifying(false);
      try { router.replace('/(tabs)'); } catch {}
    } else {
      // Enforce a minimum 400 ms visible-feedback window on wrong PIN:
      //   • Brute-force deterrence: attacker gets no speed advantage from
      //     hardware variation in PBKDF2 timing.
      //   • UX clarity: "جاري التحقق…" disappears and the error appears
      //     cleanly, not in a single jarring flash.
      const elapsed = Date.now() - start;
      if (elapsed < 400) await new Promise<void>(r => setTimeout(r, 400 - elapsed));
      setIsVerifying(false);
      shake();
      setError(t('lock.wrongPin'));
      setPin('');
      scheduleErrorClear(2500);
    }
  }, [pin, unlock, canAttempt, shake, t, router, isVerifying]);

  // Async so we can await setupPin and navigate immediately after.
  // isCreating guard prevents double-invocation during the ~500ms PBKDF2 freeze:
  // Android queues native touch events while the JS thread is blocked, so without
  // this guard a second tap during the freeze would re-run setupPin with a new salt
  // and overwrite the vault key that was just stored.
  const handleSetupSubmit = useCallback(async (pinValue?: string) => {
    if (isCreating) return;
    const p = pinValue ?? pin;
    if (p.length < 6) return;
    if (setupStep === 'create') {
      setConfirmPin(p); setPin(''); setSetupStep('confirm');
    } else {
      if (p === confirmPin) {
        setIsCreating(true);
        try {
          // setupPin now throws on crypto or storage failure with a user-readable
          // message. Await it so we navigate only AFTER state is fully updated.
          await setupPin(p);
        } catch (e) {
          // Show the specific error (Encryption failed / Storage unavailable)
          setIsCreating(false);
          setError(e instanceof Error ? e.message : 'Failed to create vault — please try again.');
          setPin(''); setConfirmPin(''); setSetupStep('create');
          scheduleErrorClear(5000);
          return;
        }
        setIsCreating(false);
        // Navigate immediately. Nav guard in _layout.tsx fires as a backup.
        // In its own try/catch so nav errors never surface as vault errors.
        try { router.replace('/(tabs)'); } catch {}
      } else {
        shake();
        setError("PINs don't match — try again.");
        setPin(''); setConfirmPin(''); setSetupStep('create');
        scheduleErrorClear(2500);
      }
    }
  }, [pin, setupStep, confirmPin, setupPin, shake, router, isCreating]);

  // Navigates immediately on success; nav guard fires as backup.
  const handleBiometric = useCallback(async () => {
    try {
      if (biometricsEnabled && biometricsAvailable) {
        const ok = await unlockWithBiometrics();
        if (ok) {
          try { router.replace('/(tabs)'); } catch {}
        } else {
          shake();
          setError(t('lock.biometricFailed') || 'فشل التحقق البيومتري — استخدم رمز المرور');
          scheduleErrorClear(2500);
        }
      } else {
        const ok = await authenticate('Unlock Auryx Vault');
        if (ok) {
          await unlock('__biometric__');
          try { router.replace('/(tabs)'); } catch {}
        }
      }
    } catch (err) {
      console.warn('[auryx][lock] handleBiometric error:', err);
      shake();
      setError('حدث خطأ، الرجاء إعادة المحاولة');
      scheduleErrorClear(2500);
    }
  }, [biometricsEnabled, biometricsAvailable, unlockWithBiometrics, authenticate, unlock, shake, t, router]);

  const handleReset = async () => {
    try {
      await wipeAll();
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch (err) {
      console.warn('[auryx][lock] handleReset error:', err);
      setError('حدث خطأ، الرجاء إعادة المحاولة');
      scheduleErrorClear(2500);
    }
  };

  const isLockedOut = !!lockoutUntil && lockoutUntil > Date.now();
  const warning = getAttemptsWarning(attempts);

  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const rst = useMemo(() => makeRstStyles(tc), [tc]);
  const ist = useMemo(() => makeIstStyles(tc), [tc]);

  // Stealth mode: show calculator when vault is already set up (not during first-time setup)
  if (stealthMode && isSetup) {
    return (
      <>
        <IntruderModal visible={intruderDetected} onDismiss={clearIntruderDetected} />
        <CalculatorLock
          onUnlock={async (pinValue) => {
            if (!canAttempt()) return false;
            setIsVerifying(true);
            const success = await unlock(pinValue);
            setIsVerifying(false);
            if (success) {
              try { router.replace('/(tabs)'); } catch {}
              return true;
            }
            return false;
          }}
        />
      </>
    );
  }

  return (
    <LinearGradient
      colors={['#0A0F1E', '#0D1428', '#111827']}
      style={[styles.container, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}
    >
      <View style={styles.ambientPurple} />
      <View style={styles.ambientGold} />
      <ScreenGlow color="#8B5CF6" icon="key" />

      <IntruderModal visible={intruderDetected} onDismiss={clearIntruderDetected} />

      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.content,
          { opacity: fadeAnim, transform: [{ translateX: shakeAnim }, { scale: logoAnim }] },
        ]}
      >
        {/* Logo */}
        <View style={styles.logoContainer}>
          <HexagonLogo size={120} />
          <Text style={styles.appName}>Auryx</Text>
          <Text style={styles.tagline}>{t('lock.subtitle')}</Text>
        </View>

        {/* Main area */}
        <View style={[styles.lockPadArea, { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 50 : 20) }]}>
          {isLockedOut ? (
            /* ── Locked out ── */
            <View style={styles.lockedContainer}>
              <View style={styles.lockedIcon}>
                <Feather name="lock" size={36} color={tc.red} />
              </View>
              <Text style={styles.lockedText}>
                {attempts >= 9 ? '🚨 Security lock — 30 minutes' : attempts >= 6 ? `6+ failed — locked 3 min` : `3+ failed — locked 1 min`}
              </Text>
              {lockoutTime ? (
                <View style={styles.timerPill}>
                  <Feather name="clock" size={12} color={tc.orange} />
                  <Text style={styles.timerText}>{lockoutTime} remaining</Text>
                </View>
              ) : null}
            </View>
          ) : isSettingUp ? (
            /* ── Create PIN ── */
            <>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>
                  {setupStep === 'create' ? 'STEP 1 OF 2' : 'STEP 2 OF 2'}
                </Text>
              </View>
              <Text style={styles.instruction}>
                {setupStep === 'create' ? 'Create a 6-digit PIN' : 'Confirm your PIN'}
              </Text>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <LockPad value={pin} onChange={setPin} maxLength={6} onSubmit={handleSetupSubmit} />
              <TouchableOpacity
                style={[styles.unlockBtn, isCreating && { opacity: 0.7 }]}
                onPress={() => handleSetupSubmit()}
                activeOpacity={0.85}
                disabled={isCreating}
              >
                <LinearGradient colors={['#D4AF37', '#B8960C']} style={styles.unlockBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  {isCreating ? (
                    <>
                      <ActivityIndicator size="small" color="#0A0F1E" style={{ marginRight: 8 }} />
                      <Text style={styles.unlockBtnText}>Creating Vault…</Text>
                    </>
                  ) : (
                    <>
                      <Feather name="shield" size={18} color="#0A0F1E" style={{ marginRight: 8 }} />
                      <Text style={styles.unlockBtnText}>
                        {setupStep === 'create' ? 'Continue' : 'Create Vault'}
                      </Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </>
          ) : (
            /* ── Unlock ── */
            <>
              {/* Instruction — shows "جاري التحقق…" with spinner while PBKDF2 runs */}
              {isVerifying ? (
                <View style={styles.verifyingRow}>
                  <ActivityIndicator size="small" color={tc.gold} />
                  <Text style={styles.verifyingText}>جاري التحقق…</Text>
                </View>
              ) : (
                <Text style={styles.instruction}>{t('lock.enterPin')}</Text>
              )}

              {!isVerifying && (
                error ? (
                  <Text style={styles.errorText}>{error}</Text>
                ) : warning ? (
                  <Text style={[styles.attemptsText, { color: warning.color }]}>{warning.text}</Text>
                ) : null
              )}

              {!isSettingUp && attempts > 0 && !error && !isVerifying && (
                <View style={styles.thresholdsRow}>
                  <View style={[styles.thresh, attempts >= 3 && { borderColor: tc.orange }]}>
                    <Text style={[styles.threshLabel, attempts >= 3 && { color: tc.orange }]}>3× = 1m</Text>
                  </View>
                  <View style={styles.threshLine} />
                  <View style={[styles.thresh, attempts >= 6 && { borderColor: tc.red }]}>
                    <Text style={[styles.threshLabel, attempts >= 6 && { color: tc.red }]}>6× = 3m</Text>
                  </View>
                  <View style={styles.threshLine} />
                  <View style={[styles.thresh, attempts >= 9 && { borderColor: tc.red, backgroundColor: `${tc.red}15` }]}>
                    <Text style={[styles.threshLabel, attempts >= 9 && { color: tc.red }]}>9× = 📸</Text>
                  </View>
                </View>
              )}

              {/* LockPad disabled during verification to prevent double-entry */}
              <LockPad
                value={pin}
                onChange={isVerifying ? () => {} : setPin}
                maxLength={6}
                onSubmit={isVerifying ? () => {} : handleUnlock}
              />

              <TouchableOpacity
                style={[styles.unlockBtn, isVerifying && { opacity: 0.75 }]}
                onPress={() => handleUnlock()}
                activeOpacity={0.85}
                disabled={isVerifying}
              >
                <LinearGradient colors={['#D4AF37', '#B8960C']} style={styles.unlockBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  {isVerifying ? (
                    <>
                      <ActivityIndicator size="small" color="#0A0F1E" style={{ marginRight: 8 }} />
                      <Text style={styles.unlockBtnText}>جاري التحقق…</Text>
                    </>
                  ) : (
                    <>
                      <Feather name="shield" size={18} color="#0A0F1E" style={{ marginRight: 8 }} />
                      <Text style={styles.unlockBtnText}>{t('lock.unlockVault')}</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              {(isAvailable || (biometricsEnabled && biometricsAvailable)) && (
                <TouchableOpacity style={styles.biometricBtn} onPress={handleBiometric} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}>
                  <Feather name={biometricType === 'facial' ? 'aperture' : 'activity'} size={20} color={tc.purple} />
                  <Text style={styles.biometricText}>
                    {biometricType === 'facial' ? t('lock.useFaceId') : t('lock.useBiometrics')}
                  </Text>
                </TouchableOpacity>
              )}

              {/* ── Forgot PIN / Reset ── */}
              {!showResetConfirm ? (
                <TouchableOpacity
                  style={styles.forgotBtn}
                  onPress={() => setShowResetConfirm(true)}
                  activeOpacity={0.6}
                  hitSlop={{ top: 14, bottom: 14, left: 20, right: 20 }}
                >
                  <Feather name="rotate-ccw" size={12} color={tc.textMuted} />
                  <Text style={styles.forgotText}>Forgot PIN? Reset Vault</Text>
                </TouchableOpacity>
              ) : (
                <ResetConfirm onConfirm={handleReset} onCancel={() => setShowResetConfirm(false)} />
              )}
            </>
          )}
        </View>
      </Animated.View>

      {/* Footer dots */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 12) }]}>
        <View style={styles.footerDot} />
        <View style={[styles.footerDot, { backgroundColor: tc.purple, opacity: 0.6 }]} />
        <View style={[styles.footerDot, { backgroundColor: tc.blue, opacity: 0.4 }]} />
      </View>
    </LinearGradient>
  );
}

/* ─── Styles ─── */
const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  container: { flex: 1 },
  ambientPurple: { position: 'absolute', top: SCREEN_HEIGHT * 0.1, left: -80, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(139,92,246,0.12)', pointerEvents: 'none' },
  ambientGold:   { position: 'absolute', top: SCREEN_HEIGHT * 0.05, right: -60, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(212,175,55,0.10)', pointerEvents: 'none' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 32, paddingTop: 20 },
  logoContainer: { alignItems: 'center', paddingTop: 10 },
  appName: { fontSize: 32, fontWeight: '700', color: tc.gold, fontFamily: 'Poppins_700Bold', letterSpacing: 4, marginTop: 10, lineHeight: 42, includeFontPadding: false },
  tagline:  { fontSize: 13, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', letterSpacing: 0.5, marginTop: 4 },
  lockPadArea: { width: '100%', alignItems: 'center' },
  stepBadge: { paddingVertical: 3, paddingHorizontal: 12, borderRadius: 20, backgroundColor: tc.goldGlass, borderWidth: 1, borderColor: 'rgba(212,175,55,0.30)', marginBottom: 10 },
  stepBadgeText: { fontSize: 10, color: tc.gold, fontFamily: 'Poppins_700Bold', letterSpacing: 1.5 },
  instruction: { fontSize: 14, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', marginBottom: 8, letterSpacing: 0.3 },
  verifyingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  verifyingText: { fontSize: 14, color: tc.gold, fontFamily: 'Poppins_400Regular', letterSpacing: 0.3 },
  errorText:   { fontSize: 13, color: tc.red, fontFamily: 'Poppins_400Regular', marginBottom: 8 },
  attemptsText: { fontSize: 12, fontFamily: 'Poppins_400Regular', marginBottom: 6 },
  thresholdsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  thresh: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, backgroundColor: tc.glass, borderWidth: 1, borderColor: tc.glassBorder },
  threshLabel: { fontSize: 10, color: tc.textMuted, fontFamily: 'Poppins_400Regular' },
  threshLine: { width: 14, height: 1, backgroundColor: tc.glassBorder },
  lockedContainer: { alignItems: 'center', gap: 16, paddingVertical: 40 },
  lockedIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.40)', alignItems: 'center', justifyContent: 'center' },
  lockedText: { fontSize: 15, color: tc.red, fontFamily: 'Poppins_600SemiBold', textAlign: 'center' },
  timerPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, backgroundColor: 'rgba(249,115,22,0.12)', borderWidth: 1, borderColor: 'rgba(249,115,22,0.35)' },
  timerText: { fontSize: 13, color: tc.orange, fontFamily: 'Poppins_600SemiBold' },
  unlockBtn: { width: '100%', marginTop: 20, borderRadius: 50, overflow: 'hidden', shadowColor: tc.gold, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  unlockBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 17, paddingHorizontal: 32 },
  unlockBtnText: { fontSize: 16, fontWeight: '700', color: '#0A0F1E', fontFamily: 'Poppins_700Bold', letterSpacing: 0.5 },
  biometricBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, paddingVertical: 10, paddingHorizontal: 20 },
  biometricText: { fontSize: 14, color: tc.purple, fontFamily: 'Poppins_400Regular' },
  forgotBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 20, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.03)' },
  forgotText: { fontSize: 12, color: tc.textMuted, fontFamily: 'Poppins_400Regular' },
  footer: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  footerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: tc.gold, opacity: 0.8 },
});

/* ─── Reset confirm styles ─── */
const makeRstStyles = (tc: ThemeColors) => StyleSheet.create({
  container: { marginTop: 16, width: '100%', backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(239,68,68,0.30)', padding: 16, alignItems: 'center', gap: 10 },
  msg: { fontSize: 12, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 18 },
  row: { flexDirection: 'row', gap: 10, width: '100%' },
  cancelBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: tc.glass, borderRadius: 12, borderWidth: 1, borderColor: tc.glassBorder },
  cancelText: { fontSize: 13, color: tc.textSecondary, fontFamily: 'Poppins_600SemiBold' },
  confirmBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: 'rgba(239,68,68,0.20)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.50)' },
  confirmText: { fontSize: 13, color: tc.red, fontFamily: 'Poppins_700Bold' },
});

/* ─── Intruder Modal styles ─── */
const makeIstStyles = (tc: ThemeColors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  ring:  { position: 'absolute', width: 300, height: 300, borderRadius: 150, borderWidth: 2, borderColor: 'rgba(239,68,68,0.35)', pointerEvents: 'none' },
  ring2: { position: 'absolute', width: 200, height: 200, borderRadius: 100, borderWidth: 2, borderColor: 'rgba(239,68,68,0.25)', pointerEvents: 'none' },
  card:  { width: '100%', backgroundColor: '#0D1428', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: 'rgba(239,68,68,0.40)', alignItems: 'center', gap: 12 },
  iconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.40)', alignItems: 'center', justifyContent: 'center' },
  title:    { fontSize: 18, fontWeight: '700', color: tc.red, fontFamily: 'Poppins_700Bold', letterSpacing: 2 },
  subtitle: { fontSize: 12, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 18 },
  selfie:   { width: 140, height: 140, borderRadius: 16, borderWidth: 2, borderColor: 'rgba(239,68,68,0.40)' },
  selfieBox:{ width: 140, height: 140, borderRadius: 16, backgroundColor: 'rgba(239,68,68,0.08)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.30)', alignItems: 'center', justifyContent: 'center', gap: 8 },
  selfieText: { fontSize: 10, color: tc.textMuted, fontFamily: 'Poppins_400Regular', textAlign: 'center', paddingHorizontal: 8 },
  sentRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sentText: { fontSize: 11, color: tc.green, fontFamily: 'Poppins_400Regular' },
  emailBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20, backgroundColor: 'rgba(239,68,68,0.10)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.40)' },
  emailText:{ fontSize: 13, color: tc.red, fontFamily: 'Poppins_600SemiBold' },
  dismiss:  { paddingVertical: 8, paddingHorizontal: 24 },
  dismissText: { fontSize: 13, color: tc.textMuted, fontFamily: 'Poppins_400Regular' },
});

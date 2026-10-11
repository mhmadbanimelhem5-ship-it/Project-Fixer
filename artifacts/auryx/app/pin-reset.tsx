import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme, ThemeColors } from '@/contexts/ThemeContext';
import { useVault } from '@/contexts/VaultContext';
import { ScreenGlow } from '@/components/shared/ScreenGlow';
import { LockPad } from '@/components/LockPad';
import {
  initiatePinResetRequest,
  fetchPinResetStatus,
  verifyPinResetOtp,
  completePinReset,
  setRecoveryEmail,
  verifyRecoveryOtp,
  completeRecovery,
  type PinResetStatus,
} from '@/utils/emailApi';

// ─── Types ────────────────────────────────────────────────────────────────────
type Phase = 'idle' | 'requesting' | 'voting' | 'otp' | 'set_pin' | 'completing' | 'success' | 'error';
type ResetMethod = 'guardian' | 'recovery' | null;

// ─── Countdown helper ─────────────────────────────────────────────────────────
const RESET_EXPIRY_MS = 72 * 60 * 60 * 1000; // 72 hours

function formatExpiry(expiresAt: number): string {
  const remaining = Math.max(0, expiresAt - Date.now());
  const totalSecs = Math.floor(remaining / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function PinResetScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { colors: c } = useTheme();
  const { legacy } = useVault();
  const { forceResetPin } = useAuth();

  const [phase, setPhase] = useState<Phase>('idle');
  const [resetMethod, setResetMethod] = useState<ResetMethod>(null);
  const [status, setStatus] = useState<PinResetStatus | null>(null);

  // Recovery Email States
  const [recoveryEmailInput, setRecoveryEmailInput] = useState('');

  // OTP & PIN States
  const [otpCode, setOtpCode] = useState('');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [setupStep, setSetupStep] = useState<'create' | 'confirm'>('create');
  const [errorMsg, setErrorMsg] = useState('');
  const [countdown, setCountdown] = useState('');

  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const styles = useMemo(() => makeStyles(c), [c]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (toastRef.current) clearTimeout(toastRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  // ── Poll guardian vote status every 15s during voting phase ──────────────
  useEffect(() => {
    if (phase !== 'voting' || resetMethod !== 'guardian') return;
    const ownerEmail = (legacy.ownerEmail || '').trim().toLowerCase();
    if (!ownerEmail) return;

    let mounted = true;
    const poll = async () => {
      try {
        const s = await fetchPinResetStatus(ownerEmail);
        if (!mounted || !s) return;
        setStatus(s);
        if (s.quorumReached && s.otpSent) {
          setPhase('otp');
          if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else if (s.status === 'rejected') {
          setPhase('error');
          setErrorMsg(t('pinReset.rejectedByGuardians') || 'تم رفض الطلب من قبل الأوصياء');
        } else if (s.status === 'expired') {
          setPhase('error');
          setErrorMsg(t('pinReset.requestExpired') || 'انتهت صلاحية الطلب');
        }
      } catch { /* silent */ }
    };

    void poll();
    pollRef.current = setInterval(() => void poll(), 15_000);
    return () => {
      mounted = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [phase, resetMethod, legacy.ownerEmail, t]);

  // ── Countdown ticker during voting ───────────────────────────────────────
  useEffect(() => {
    if (phase !== 'voting' || !status?.expiresAt) return;
    const tick = () => setCountdown(formatExpiry(status.expiresAt!));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, status?.expiresAt]);

  // ── Start Guardian PIN reset request ──────────────────────────────────────
  const handleStartGuardianRequest = useCallback(async () => {
    const ownerEmail = (legacy.ownerEmail || '').trim().toLowerCase();
    const ownerName = legacy.ownerName || '';
    if (!ownerEmail) {
      setErrorMsg(t('pinReset.noOwnerEmail') || 'بريد المالك غير مُضبوط');
      setPhase('error');
      return;
    }
    setPhase('requesting');
    setErrorMsg('');
    try {
      const result = await initiatePinResetRequest(ownerEmail, ownerName);
      if (result.success) {
        setPhase('voting');
        const s = await fetchPinResetStatus(ownerEmail);
        if (s) setStatus(s);
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setPhase('idle');
        setErrorMsg(result.error || t('pinReset.requestFailed') || 'فشل إرسال الطلب');
      }
    } catch {
      setPhase('idle');
      setErrorMsg(t('pinReset.networkError') || 'تعذّر الاتصال بالخادم');
    }
  }, [legacy.ownerEmail, legacy.ownerName, t]);

  // ── Send Recovery Email OTP ───────────────────────────────────────────────
  const handleSendRecoveryOtp = useCallback(async () => {
    const email = recoveryEmailInput.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrorMsg(t('recovery.invalidEmail') || 'بريد إلكتروني غير صالح');
      return;
    }
    setPhase('requesting');
    setErrorMsg('');
    try {
      // Calling setRecoveryEmail will upsert, generate OTP, and send it
      const result = await setRecoveryEmail(email);
      if (result.success) {
        setPhase('otp');
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setPhase('idle');
        setErrorMsg(result.error || t('pinReset.networkError'));
      }
    } catch {
      setPhase('idle');
      setErrorMsg(t('pinReset.networkError'));
    }
  }, [recoveryEmailInput, t]);

  // ── Verify OTP (Handles both Guardian and Recovery) ───────────────────────
  const handleVerifyOtp = useCallback(async () => {
    const code = otpCode.replace(/\s/g, '').trim();
    if (code.length < 6) return;

    setPhase('completing');
    setErrorMsg('');

    try {
      if (resetMethod === 'recovery') {
        const email = recoveryEmailInput.trim().toLowerCase();
        const result = await verifyRecoveryOtp(email, code);
        if (result.success && result.recoveryToken) {
          setResetToken(result.recoveryToken);
          setPhase('set_pin');
          setSetupStep('create');
          setNewPin('');
          setConfirmPin('');
          if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          setPhase('otp');
          setOtpCode('');
          setErrorMsg(result.error || t('pinReset.invalidOtp'));
        }
      } else {
        // Guardian flow
        const ownerEmail = (legacy.ownerEmail || '').trim().toLowerCase();
        const result = await verifyPinResetOtp(ownerEmail, code);
        if (result.success && result.resetToken) {
          setResetToken(result.resetToken);
          setPhase('set_pin');
          setSetupStep('create');
          setNewPin('');
          setConfirmPin('');
          if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          setPhase('otp');
          setOtpCode('');
          setErrorMsg(result.error || t('pinReset.invalidOtp'));
        }
      }
    } catch {
      setPhase('otp');
      setOtpCode('');
      setErrorMsg(t('pinReset.networkError'));
    }
  }, [otpCode, resetMethod, recoveryEmailInput, legacy.ownerEmail, t]);

  // ── Set new PIN (after OTP verified) ─────────────────────────────────────
  const handleSetNewPin = useCallback(async (pinValue?: string) => {
    const p = pinValue ?? newPin;
    if (p.length < 6) return;

    if (setupStep === 'create') {
      setConfirmPin(p);
      setNewPin('');
      setSetupStep('confirm');
      setErrorMsg('');
      return;
    }

    // Confirm step
    if (p !== confirmPin) {
      setErrorMsg(t('pinReset.pinsDontMatch') || 'الرمزان غير متطابقين');
      setNewPin('');
      setConfirmPin('');
      setSetupStep('create');
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    // Both match — write new PIN + mark completed on server
    setPhase('completing');
    setErrorMsg('');
    try {
      const pinOk = await forceResetPin(p);
      if (!pinOk) {
        setPhase('set_pin');
        setErrorMsg(t('pinReset.storageError') || 'فشل حفظ الرمز الجديد');
        return;
      }

      // Finalize based on method
      if (resetMethod === 'recovery' && resetToken) {
        await completeRecovery(resetToken);
      } else if (resetMethod === 'guardian' && resetToken) {
        const ownerEmail = (legacy.ownerEmail || '').trim().toLowerCase();
        if (ownerEmail) {
          await completePinReset(ownerEmail, resetToken);
        }
      }

      setPhase('success');
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setPhase('set_pin');
      setErrorMsg(t('pinReset.unknownError') || 'حدث خطأ غير معروف');
    }
  }, [newPin, confirmPin, setupStep, forceResetPin, resetToken, resetMethod, legacy.ownerEmail, t]);

  // ── Go back to lock screen ───────────────────────────────────────────────
  const handleBackToLock = () => {
    router.replace('/lock');
  };

  // ── Reset to initial state ───────────────────────────────────────────────
  const handleResetToIdle = () => {
    setPhase('idle');
    setResetMethod(null);
    setErrorMsg('');
    setStatus(null);
    setOtpCode('');
    setResetToken(null);
    setNewPin('');
    setConfirmPin('');
    setSetupStep('create');
    setCountdown('');
    setRecoveryEmailInput('');
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <LinearGradient
      colors={['#0A0F1E', '#0D1428', '#111827']}
      style={[styles.container, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}
    >
      <View style={styles.ambientPurple} />
      <View style={styles.ambientGold} />
      <ScreenGlow color="#D4AF37" icon="key" />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBackToLock} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="arrow-right" size={22} color={c.textMuted} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('pinReset.title') || 'استعادة رمز الدخول'}</Text>
          <View style={{ width: 22 }} />
        </View>

        {/* ── IDLE: Method Selection ──────────────────────────────────────── */}
        {phase === 'idle' && resetMethod === null && (
          <View style={styles.centerBlock}>
            <View style={[styles.iconWrap, { backgroundColor: 'rgba(212,175,55,0.10)', borderColor: 'rgba(212,175,55,0.30)' }]}>
              <Feather name="shield" size={36} color={c.gold} />
            </View>
            <Text style={styles.title}>{t('pinReset.heading') || 'نسيت رمز الدخول؟'}</Text>
            <Text style={styles.subtitle}>
              {t('pinReset.description') || 'اختر طريقة الاستعادة المفضلة لديك للمتابعة بأمان.'}
           5</Text>

            <View style={styles.infoCard}>
              <Feather name="info" size={14} color={c.gold} />
              <Text style={styles.infoText}>
                {t('pinReset.dataSafe') || 'بياناتك مشفرة وآمنة — يتم تغيير رمز الدخول فقط دون لمس أي محتوى.'}
              </Text>
            </View>

            <TouchableOpacity style={styles.ctaBtn} onPress={() => setResetMethod('guardian')} activeOpacity={0.85}>
              <LinearGradient colors={['#D4AF37', '#B8960C']} style={styles.ctaBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Feather name="users" size={18} color="#0A0F1E" style={{ marginLeft: 8 }} />
                <Text style={styles.ctaBtnText}>استعادة عبر الأوصياء</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.ctaBtn, { marginTop: 12 }]} onPress={() => setResetMethod('recovery')} activeOpacity={0.85}>
              <LinearGradient colors={['#14B8A6', '#0D9488']} style={styles.ctaBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Feather name="mail" size={18} color="#fff" style={{ marginLeft: 8 }} />
                <Text style={[styles.ctaBtnText, { color: '#fff' }]}>{t('pinReset.useRecoveryEmail') || 'استعادة عبر إيميل الاسترجاع'}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* ── IDLE: Guardian Flow ─────────────────────────────────────────── */}
        {phase === 'idle' && resetMethod === 'guardian' && (
          <View style={styles.centerBlock}>
            <TouchableOpacity style={styles.backMethodBtn} onPress={handleResetToIdle}>
              <Feather name="arrow-right" size={16} color={c.textMuted} />
              <Text style={styles.backMethodText}>تغيير طريقة الاستعادة</Text>
            </TouchableOpacity>

            <View style={[styles.iconWrap, { backgroundColor: 'rgba(212,175,55,0.10)', borderColor: 'rgba(212,175,55,0.30)' }]}>
              <Feather name="users" size={36} color={c.gold} />
            </View>
            <Text style={styles.title}>استعادة عبر الأوصياء</Text>
            <Text style={styles.subtitle}>
              سيتم إرسال طلب موافقة إلى أوصيائك الموثوقين. عند موافقة العدد المطلوب، ستتمكن من تعيين رمز دخول جديد.
            </Text>

            <TouchableOpacity style={styles.ctaBtn} onPress={handleStartGuardianRequest} activeOpacity={0.85}>
              <LinearGradient colors={['#D4AF37', '#B8960C']} style={styles.ctaBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Feather name="send" size={18} color="#0A0F1E" style={{ marginLeft: 8 }} />
                <Text style={styles.ctaBtnText}>{t('pinReset.sendRequest') || 'إرسال طلب الاستعادة'}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* ── IDLE: Recovery Email Flow ───────────────────────────────────── */}
        {phase === 'idle' && resetMethod === 'recovery' && (
          <View style={styles.centerBlock}>
            <TouchableOpacity style={styles.backMethodBtn} onPress={handleResetToIdle}>
              <Feather name="arrow-right" size={16} color={c.textMuted} />
              <Text style={styles.backMethodText}>تغيير طريقة الاستعادة</Text>
            </TouchableOpacity>

            <View style={[styles.iconWrap, { backgroundColor: 'rgba(20,184,166,0.10)', borderColor: 'rgba(20,184,166,0.30)' }]}>
              <Feather name="mail" size={36} color={c.teal} />
            </View>
            <Text style={styles.title}>{t('recovery.enterEmail') || 'أدخل إيميل الاسترجاع'}</Text>
            <Text style={styles.subtitle}>
              {t('pinReset.recoveryEmailDesc') || 'أدخل بريد الاسترجاع الخاص بك لتلقي رمز التحقق.'}
            </Text>

            {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

            <View style={styles.inputBlock}>
              <TextInput
                style={styles.textInput}
                value={recoveryEmailInput}
                onChangeText={(v) => { setRecoveryEmailInput(v); setErrorMsg(''); }}
                placeholder={t('recovery.emailPlaceholder') || 'example@domain.com'}
                placeholderTextColor={c.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <TouchableOpacity 
              style={[styles.ctaBtn, { opacity: !recoveryEmailInput ? 0.5 : 1 }]} 
              onPress={handleSendRecoveryOtp} 
              activeOpacity={0.85}
              disabled={!recoveryEmailInput}
            >
              <LinearGradient colors={['#14B8A6', '#0D9488']} style={styles.ctaBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Text style={[styles.ctaBtnText, { color: '#fff' }]}>{t('recovery.sendOtp') || 'إرسال رمز التحقق'}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* ── REQUESTING ───────────────────────────────────────────────────── */}
        {phase === 'requesting' && (
          <View style={styles.centerBlock}>
            <ActivityIndicator size="large" color={c.gold} />
            <Text style={[styles.subtitle, { marginTop: 20 }]}>
              {resetMethod === 'recovery' 
                ? (t('recovery.sendingOtp') || 'جارٍ إرسال الرمز...')
                : (t('pinReset.sendingRequest') || 'جارٍ إرسال الطلب إلى الأوصياء…')}
            </Text>
          </View>
        )}

        {/* ── VOTING (Guardian Only) ──────────────────────────────────────── */}
        {phase === 'voting' && status && resetMethod === 'guardian' && (
          <View style={styles.centerBlock}>
            <View style={[styles.iconWrap, { backgroundColor: 'rgba(212,175,55,0.10)', borderColor: 'rgba(212,175,55,0.30)' }]}>
              <Feather name="users" size={36} color={c.gold} />
            </View>
            <Text style={styles.title}>{t('pinReset.waitingApproval') || 'بانتظار موافقة الأوصياء'}</Text>
            <Text style={styles.subtitle}>
              {t('pinReset.votingDesc') || 'تم إرسال روابط الموافقة إلى أوصيائك عبر البريد الإلكتروني.'}
            </Text>

            <View style={styles.tallyRow}>
              <Text style={[styles.tallyBig, { color: c.gold }]}>{status.approvals}</Text>
              <Text style={styles.tallySlash}>/{status.threshold}</Text>
              <Text style={styles.tallyLabel}>{' '}{t('pinReset.approvals') || 'موافقات'}</Text>
            </View>

            {status.expiresAt && (
              <View style={styles.countdownBox}>
                <Text style={[styles.countdownTime, { color: c.gold }]}>{countdown || '--:--:--'}</Text>
                <Text style={styles.countdownSub}>{t('pinReset.timeRemaining') || 'الوقت المتبقي'}</Text>
              </View>
            )}

            {status.decisions.length > 0 && (
              <View style={styles.guardiansBlock}>
                {status.decisions.map((d, i) => {
                  const dc = d.decision === 'approve' ? c.green : d.decision === 'reject' ? c.red : c.gold;
                  const dIcon: 'check-circle' | 'x-circle' | 'clock' =
                    d.decision === 'approve' ? 'check-circle' : d.decision === 'reject' ? 'x-circle' : 'clock';
                  const dLabel = d.decision === 'approve'
                    ? (t('pinReset.approved') || 'وافق')
                    : d.decision === 'reject'
                      ? (t('pinReset.rejected') || 'رفض')
                      : (t('pinReset.pending') || 'في الانتظار');
                  const displayName = d.guardianEmail.split('@')[0] ?? d.guardianEmail;
                  const initial = displayName.charAt(0).toUpperCase();
                  return (
                    <View
                      key={d.guardianEmail}
                      style={[
                        styles.guardianRow,
                        { borderRightColor: dc },
                        i > 0 && { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
                      ]}
                    >
                      <View style={[styles.guardianAvatar, { backgroundColor: `${dc}20` }]}>
                        <Text style={[styles.guardianInitial, { color: dc }]}>{initial}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.guardianName}>{displayName}</Text>
                        <Text style={styles.guardianEmail} numberOfLines={1}>{d.guardianEmail}</Text>
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: `${dc}15`, borderColor: `${dc}30` }]}>
                        <Feather name={dIcon} size={11} color={dc} />
                        <Text style={[styles.statusPillText, { color: dc }]}>{dLabel}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={styles.pollRow}>
              <Feather name="refresh-cw" size={10} color={c.textMuted} />
              <Text style={styles.pollText}>{t('pinReset.pollingEvery15s') || 'تحديث تلقائي كل 15 ثانية'}</Text>
            </View>
          </View>
        )}

        {/* ── OTP (Shared for Guardian & Recovery) ────────────────────────── */}
        {phase === 'otp' && (
          <View style={styles.centerBlock}>
            <TouchableOpacity style={styles.backMethodBtn} onPress={handleResetToIdle}>
              <Feather name="arrow-right" size={16} color={c.textMuted} />
              <Text style={styles.backMethodText}>العودة واختيار طريقة أخرى</Text>
            </TouchableOpacity>

            <View style={[styles.iconWrap, { backgroundColor: 'rgba(34,197,94,0.10)', borderColor: 'rgba(34,197,94,0.30)' }]}>
              <Feather name="mail" size={36} color={c.green} />
            </View>
            <Text style={styles.title}>{t('pinReset.enterOtp') || 'أدخل رمز التحقق'}</Text>
            <Text style={styles.subtitle}>
              {resetMethod === 'recovery'
                ? `تم إرسال رمز تحقق مكوّن من 6 أرقام إلى ${recoveryEmailInput}`
                : (t('pinReset.otpDesc') || 'تم إرسال رمز تحقق مكوّن من 6 أرقام إلى بريدك الإلكتروني.')}
            </Text>

            {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

            <View style={styles.otpBlock}>
              <TextInput
                style={[styles.otpInput, { color: c.gold }]}
                value={otpCode}
                onChangeText={setOtpCode}
                placeholder={t('pinReset.otpPlaceholder') || 'مثال: 847293'}
                placeholderTextColor={c.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                textAlign="center"
                autoFocus
              />
            </View>

            <TouchableOpacity
              style={[styles.ctaBtn, { opacity: otpCode.replace(/\s/g, '').length < 6 ? 0.5 : 1 }]}
              onPress={handleVerifyOtp}
              activeOpacity={0.85}
              disabled={otpCode.replace(/\s/g, '').length < 6}
            >
              <LinearGradient colors={['#22C55E', '#16A34A']} style={styles.ctaBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Text style={[styles.ctaBtnText, { color: '#fff' }]}>{t('pinReset.verifyOtp') || 'تحقق ومتابعة'}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* ── SET NEW PIN ──────────────────────────────────────────────────── */}
        {phase === 'set_pin' && (
          <View style={styles.centerBlock}>
            <View style={[styles.iconWrap, { backgroundColor: 'rgba(212,175,55,0.10)', borderColor: 'rgba(212,175,55,0.30)' }]}>
              <Feather name="lock" size={36} color={c.gold} />
            </View>
            <Text style={styles.title}>
              {setupStep === 'create'
                ? (t('pinReset.createNewPin') || 'أنشئ رمز دخول جديد')
                : (t('pinReset.confirmNewPin') || 'أكّد رمز الدخول الجديد')}
            </Text>
            <Text style={styles.subtitle}>
              {setupStep === 'create'
                ? (t('pinReset.newPinDesc') || 'اختر رمز PIN مكوّن من 6 أرقام')
                : (t('pinReset.confirmPinDesc') || 'أعد إدخال الرمز للتأكيد')}
            </Text>

            {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

            <LockPad
              value={newPin}
              onChange={setNewPin}
              maxLength={6}
              onSubmit={handleSetNewPin}
            />

            <TouchableOpacity
              style={styles.ctaBtn}
              onPress={() => handleSetNewPin()}
              activeOpacity={0.85}
            >
              <LinearGradient colors={['#D4AF37', '#B8960C']} style={styles.ctaBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Text style={styles.ctaBtnText}>
                  {setupStep === 'create'
                    ? (t('pinReset.continue') || 'متابعة')
                    : (t('pinReset.savePin') || 'حفظ الرمز الجديد')}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* ── COMPLETING ───────────────────────────────────────────────────── */}
        {phase === 'completing' && (
          <View style={styles.centerBlock}>
            <ActivityIndicator size="large" color={c.gold} />
            <Text style={[styles.subtitle, { marginTop: 20 }]}>
              {t('pinReset.completing') || 'جارٍ حفظ الرمز الجديد…'}
            </Text>
          </View>
        )}

        {/* ── SUCCESS ──────────────────────────────────────────────────────── */}
        {phase === 'success' && (
          <View style={styles.centerBlock}>
            <View style={[styles.iconWrap, { backgroundColor: 'rgba(34,197,94,0.15)', borderColor: 'rgba(34,197,94,0.40)' }]}>
              <Feather name="check-circle" size={40} color={c.green} />
            </View>
            <Text style={[styles.title, { color: c.green }]}>{t('pinReset.successTitle') || 'تم استعادة رمز الدخول بنجاح!'}</Text>
            <Text style={styles.subtitle}>
              {t('pinReset.successDesc') || 'يمكنك الآن استخدام رمز الدخول الجديد لفتح التطبيق. بياناتك لم تتأثر.'}
            </Text>
            <TouchableOpacity style={styles.ctaBtn} onPress={handleBackToLock} activeOpacity={0.85}>
              <LinearGradient colors={['#22C55E', '#16A34A']} style={styles.ctaBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Feather name="lock" size={18} color="#fff" style={{ marginLeft: 8 }} />
                <Text style={[styles.ctaBtnText, { color: '#fff' }]}>{t('pinReset.backToLock') || 'العودة إلى شاشة القفل'}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* ── ERROR ────────────────────────────────────────────────────────── */}
        {phase === 'error' && (
          <View style={styles.centerBlock}>
            <View style={[styles.iconWrap, { backgroundColor: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.35)' }]}>
              <Feather name="alert-circle" size={36} color={c.red} />
            </View>
            <Text style={[styles.title, { color: c.red }]}>{t('pinReset.errorTitle') || 'حدث خطأ'}</Text>
            <Text style={styles.subtitle}>{errorMsg || t('pinReset.genericError') || 'حاول مرة أخرى لاحقاً.'}</Text>
            <TouchableOpacity style={styles.ctaBtn} onPress={handleResetToIdle} activeOpacity={0.85}>
              <LinearGradient colors={['#D4AF37', '#B8960C']} style={styles.ctaBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Feather name="refresh-cw" size={18} color="#0A0F1E" style={{ marginLeft: 8 }} />
                <Text style={styles.ctaBtnText}>{t('pinReset.retry') || 'إعادة المحاولة'}</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleBackToLock} activeOpacity={0.7} style={{ marginTop: 16 }}>
              <Text style={styles.backLink}>{t('pinReset.backToLock') || 'العودة إلى شاشة القفل'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1 },
  ambientPurple: { position: 'absolute', top: 120, left: -80, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(139,92,246,0.10)', pointerEvents: 'none' },
  ambientGold:   { position: 'absolute', top: 60, right: -60, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(212,175,55,0.08)', pointerEvents: 'none' },
  scrollContent: { paddingHorizontal: 24, paddingTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: c.text, fontFamily: 'Poppins_700Bold', letterSpacing: 1 },
  centerBlock: { alignItems: 'center', gap: 16, width: '100%' },
  iconWrap: {
    width: 80, height: 80, borderRadius: 40, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  title: { fontSize: 22, fontWeight: '700', color: c.text, fontFamily: 'Poppins_700Bold', textAlign: 'center', letterSpacing: 1 },
  subtitle: { fontSize: 14, color: c.textSecondary, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22, paddingHorizontal: 8 },
  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: 'rgba(212,175,55,0.06)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.20)',
    borderRadius: 14, padding: 14, width: '100%',
  },
  infoText: { fontSize: 12, color: c.gold, fontFamily: 'Poppins_400Regular', flex: 1, lineHeight: 18 },
  ctaBtn: { width: '100%', borderRadius: 50, overflow: 'hidden', marginTop: 8, shadowColor: '#D4AF37', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6 },
  ctaBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 17, paddingHorizontal: 32 },
  ctaBtnText: { fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold', letterSpacing: 0.5 },
  errorText: { fontSize: 13, color: '#EF4444', fontFamily: 'Poppins_400Regular', textAlign: 'center' },
  tallyRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2, marginVertical: 8 },
  tallyBig: { fontSize: 36, fontWeight: '700', fontFamily: 'Poppins_700Bold' },
  tallySlash: { fontSize: 18, color: c.textMuted, fontFamily: 'Poppins_400Regular' },
  tallyLabel: { fontSize: 13, color: c.textSecondary, fontFamily: 'Poppins_400Regular' },
  countdownBox: { borderWidth: 1, borderRadius: 20, paddingVertical: 16, paddingHorizontal: 28, alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.25)', borderColor: 'rgba(212,175,55,0.30)' },
  countdownTime: { fontSize: 36, fontWeight: '700', fontFamily: 'Poppins_700Bold', letterSpacing: 3, lineHeight: 44 },
  countdownSub: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: c.textMuted },
  guardiansBlock: {
    width: '100%', backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)', borderRadius: 14, overflow: 'hidden', marginTop: 8,
  },
  guardianRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 10, borderRightWidth: 3 },
  guardianAvatar: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  guardianInitial: { fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' },
  guardianName: { fontSize: 13, color: c.text, fontFamily: 'Poppins_600SemiBold' },
  guardianEmail: { fontSize: 11, color: c.textMuted, fontFamily: 'Poppins_400Regular', marginTop: 1 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  statusPillText: { fontSize: 10, fontFamily: 'Poppins_600SemiBold' },
  pollRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  pollText: { fontSize: 10, color: c.textMuted, fontFamily: 'Poppins_400Regular' },
  inputBlock: {
    width: '100%', backgroundColor: 'rgba(20,184,166,0.06)',
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(20,184,166,0.28)', overflow: 'hidden',
  },
  textInput: { paddingVertical: 16, paddingHorizontal: 16, fontSize: 15, color: c.text, fontFamily: 'Poppins_400Regular', textAlign: 'center' },
  otpBlock: {
    width: '100%', backgroundColor: 'rgba(212,175,55,0.06)',
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(212,175,55,0.28)', overflow: 'hidden',
  },
  otpInput: { paddingVertical: 20, paddingHorizontal: 20, fontSize: 30, fontWeight: '700', fontFamily: 'Poppins_700Bold', letterSpacing: 10, textAlign: 'center' },
  backLink: { fontSize: 13, color: c.textMuted, fontFamily: 'Poppins_400Regular' },
  backMethodBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20,
  },
  backMethodText: { fontSize: 12, color: c.textMuted, fontFamily: 'Poppins_400Regular' },
});
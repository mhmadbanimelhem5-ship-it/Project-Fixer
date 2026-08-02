import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useVault } from '@/contexts/VaultContext';
import { useTheme, ThemeColors } from '@/contexts/ThemeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  triggerEmergencyEmail,
  initiateServerAbsenceProtocol,
  fetchServerAbsenceStatus,
  triggerStartVote,
  fetchGuardianVoteStatus,
  type GuardianVoteStatus,
} from '@/utils/emailApi';
import { getApiBase } from '@/utils/apiBase';
import { authenticatedFetch } from '@/utils/authenticatedFetch';
import { fetchVaultPackage } from '@/utils/vaultTransferApi';
import { ScreenGlow } from '@/components/shared/ScreenGlow';

const { width: SW } = Dimensions.get('window');
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

// ── Decorative pulsing ring (owner emergency button) ───────────────────────
function PulsingRing({ color, size, delay = 0, intensity = 1 }: {
  color: string; size: number; delay?: number; intensity?: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
  const opacity = anim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [intensity * 0.9, intensity * 0.5, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', width: size, height: size, borderRadius: size / 2,
        borderWidth: 2, borderColor: color, transform: [{ scale }], opacity,
        pointerEvents: 'none',
      }}
    />
  );
}

// ── Countdown timer (owner waiting phase) ──────────────────────────────────
function Countdown({ from }: { from: number }) {
  const [remaining, setRemaining] = useState(from - Date.now());
  useEffect(() => {
    const id = setInterval(() => setRemaining(from - Date.now()), 1000);
    return () => clearInterval(id);
  }, [from]);
  const { colors: tc } = useTheme();
  const { t } = useLanguage();
  const { width: sw } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const totalSec = Math.max(0, Math.floor(remaining / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const numFontSize = Math.round(Math.min(28, Math.max(20, sw * 0.068)));
  const numLineHeight = Math.round(numFontSize * 1.3);
  const cellMinWidth = Math.round(numFontSize * 1.75);
  const sepFontSize = Math.round(numFontSize * 0.86);
  const numStyle = { fontSize: numFontSize, lineHeight: numLineHeight };
  const sepStyle = { fontSize: sepFontSize, lineHeight: numLineHeight, marginBottom: numFontSize * 0.36 };
  return (
    <View style={styles.countdown}>
      <View style={[styles.countdownCell, { minWidth: cellMinWidth }]}>
        <Text style={[styles.countdownNum, numStyle]} allowFontScaling={false} numberOfLines={1}>{pad(h)}</Text>
        <Text style={styles.countdownLbl} allowFontScaling={false} numberOfLines={1}>{t('emergency.hours')}</Text>
      </View>
      <Text style={[styles.countdownSep, sepStyle]} allowFontScaling={false}>:</Text>
      <View style={[styles.countdownCell, { minWidth: cellMinWidth }]}>
        <Text style={[styles.countdownNum, numStyle]} allowFontScaling={false} numberOfLines={1}>{pad(m)}</Text>
        <Text style={styles.countdownLbl} allowFontScaling={false} numberOfLines={1}>{t('emergency.minutes')}</Text>
      </View>
      <Text style={[styles.countdownSep, sepStyle]} allowFontScaling={false}>:</Text>
      <View style={[styles.countdownCell, { minWidth: cellMinWidth }]}>
        <Text style={[styles.countdownNum, numStyle]} allowFontScaling={false} numberOfLines={1}>{pad(s)}</Text>
        <Text style={styles.countdownLbl} allowFontScaling={false} numberOfLines={1}>{t('emergency.seconds')}</Text>
      </View>
    </View>
  );
}

type Phase = 'idle' | 'waiting' | 'voting' | 'complete';

export default function EmergencyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { legacy, guardians, addAuditEntry } = useVault();

  const [phase, setPhase] = useState<Phase>('idle');
  const [activatedAt, setActivatedAt] = useState<number | null>(null);
  const [ownerNotifCount, setOwnerNotifCount] = useState(0);
  const [voteRequestSent, setVoteRequestSent] = useState(false);
  const [voteLoading, setVoteLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);
  const [serverProtocolActive, setServerProtocolActive] = useState(false);
  const [voteStatus, setVoteStatus] = useState<GuardianVoteStatus | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { t } = useLanguage();
  const { colors: tc } = useTheme();
  const isBeneficiaryRole = legacy.userRole === 'beneficiary';

  const ownerName = isBeneficiaryRole
    ? (legacy.beneficiaryOwnerName || t('legacy.ownerDefault'))
    : (legacy.ownerName || t('legacy.ownerDefault'));
  const ownerEmail = (legacy.ownerEmail || '').trim().toLowerCase();
  const beneficiaryName = isBeneficiaryRole
    ? (legacy.ownerName || t('legacy.beneficiary'))
    : (legacy.beneficiary?.name || t('legacy.beneficiary'));
  const deadline48h = activatedAt ? activatedAt + FORTY_EIGHT_HOURS_MS : 0;

  useEffect(() => {
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, []);

  const showToast = useCallback((msg: string, color = tc.green) => {
    setToast({ msg, color });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, [tc.green]);

  // All emergency state is scoped to the current ownerEmail. Clear every
  // owner-specific value before any effect starts loading the new owner.
  const resetOwnerState = useCallback(() => {
    setPhase('idle');
    setActivatedAt(null);
    setOwnerNotifCount(0);
    setVoteRequestSent(false);
    setVoteLoading(false);
    setServerProtocolActive(false);
    setVoteStatus(null);
    setOtpCode('');
    setOtpLoading(false);
    setOtpSent(false);
    setVaultUnlocked(false);
    setToast(null);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  // Changing ownerEmail starts a new state lifetime. The cleanup from each
  // owner-dependent effect also marks its in-flight request as stale.
  useEffect(() => {
    resetOwnerState();
  }, [ownerEmail, resetOwnerState]);

  // ── Owner: start server absence protocol ───────────────────────────────────
  useEffect(() => {
    if (phase !== 'waiting' || !ownerEmail || serverProtocolActive) return;
    let mounted = true;
    setServerProtocolActive(true);
    const start = async () => {
      const result = await initiateServerAbsenceProtocol(ownerEmail, beneficiaryName, ownerName);
      if (!mounted) return;
      if (result.success && result.requestId) {
        addAuditEntry('absence_protocol_server_started', 'app');
        showToast(t('emergency.ownerNotifSent', { count: 1 }), tc.blue);
      }
    };
    void start().catch(() => {});
    return () => { mounted = false; };
  }, [phase, ownerEmail, serverProtocolActive, beneficiaryName, ownerName, addAuditEntry, showToast, t, tc.blue]);

  // ── Owner: poll server status every 30s ────────────────────────────────────
  useEffect(() => {
    if (phase !== 'waiting' || !ownerEmail) return;
    let mounted = true;
    const poll = async () => {
      const status = await fetchServerAbsenceStatus(ownerEmail);
      if (!mounted || !status) return;
      setOwnerNotifCount(status.ownerNotifCount);
      if (status.status === 'cancelled_by_owner') {
        addAuditEntry('absence_protocol_cancelled_by_owner', 'app');
        showToast(t('emergency.cancelledByOwner'), tc.green);
        setPhase('idle');
      } else if (status.status === 'pending_guardian_vote' && phase === 'waiting') {
        setPhase('voting');
      } else if (status.status === 'guardian_approved') {
        setPhase('complete');
        addAuditEntry('guardian_quorum_reached', 'app');
      }
    };
    void poll().catch(() => {});
    const id = setInterval(() => { void poll().catch(() => {}); }, 30_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [phase, ownerEmail, addAuditEntry, showToast, t, tc.green]);

  // ── Poll guardian vote status every 20s while voting ──────────────────────
  useEffect(() => {
    if (phase !== 'voting' || !ownerEmail) return;
    let mounted = true;
    const poll = async () => {
      const status = await fetchGuardianVoteStatus(ownerEmail);
      if (!mounted || !status) return;
      setVoteStatus(status);
      if (status.quorumReached && phase === 'voting') {
        setPhase('complete');
        addAuditEntry('guardian_quorum_reached', 'app');
        showToast(t('emergency.quorumReached'), tc.green);
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    };
    void poll().catch(() => {});
    const id = setInterval(() => { void poll().catch(() => {}); }, 20_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [phase, ownerEmail, addAuditEntry, showToast, t, tc.green]);

  // ── Owner: auto-advance to voting after 48h ────────────────────────────────
  useEffect(() => {
    if (phase !== 'waiting' || !activatedAt) return;
    const remaining = deadline48h - Date.now();
    if (remaining <= 0) { setPhase('voting'); return; }
    const timer = setTimeout(() => setPhase('voting'), remaining);
    return () => clearTimeout(timer);
  }, [phase, activatedAt, deadline48h]);

  // ── Resolve guardian emails ────────────────────────────────────────────────
  const resolveGuardianEmails = useCallback(async (): Promise<string[]> => {
    if (isBeneficiaryRole && ownerEmail) {
      try {
        const pkg = await fetchVaultPackage(ownerEmail);
        if (pkg && pkg.guardianPackages.length > 0) {
          return pkg.guardianPackages.map(gp => gp.email).filter(Boolean);
        }
      } catch {}
    }
    return guardians.map(g => g.email).filter(Boolean);
  }, [isBeneficiaryRole, ownerEmail, guardians]);

  // ── Owner: activate emergency (waiting phase) ──────────────────────────────
  const handleActivate = async () => {
    if (phase !== 'idle') return;
    if (Platform.OS !== 'web') {
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
    }
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.92, duration: 100, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1.04, duration: 150, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
    Animated.timing(glowOpacity, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    const now = Date.now();
    setActivatedAt(now);
    setPhase('waiting');
    addAuditEntry('emergency_protocol_activated', 'app');
    const guardianEmails = await resolveGuardianEmails();
    if (guardianEmails.length > 0) {
      const relation = (legacy.beneficiary as any)?.relationship ?? '';
      await triggerEmergencyEmail(legacy.ownerEmail || '', ownerName, beneficiaryName, relation, guardianEmails);
    }
  };

  // ── Beneficiary: request guardian vote → goes directly to voting ───────────
  const handleBeneficiaryActivate = async () => {
    if (voteLoading || phase !== 'idle') return;
    if (!ownerEmail) { showToast(t('emergency.noOwnerEmail'), tc.orange); return; }
    setVoteLoading(true);
    try {
      const now = Date.now();
      setActivatedAt(now);
      setPhase('voting');
      addAuditEntry('emergency_protocol_activated', 'app');
      addAuditEntry('vote_request_sent', 'app');

      const result = await triggerStartVote(ownerEmail, beneficiaryName, legacy.ownerName ?? '');
      if (result.success) {
        setVoteRequestSent(true);
        showToast(t('emergency.voteSentToast'), tc.green);
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const status = await fetchGuardianVoteStatus(ownerEmail);
        if (status) {
          setVoteStatus(status);
          if (status.quorumReached) {
            setPhase('complete');
            addAuditEntry('guardian_quorum_reached', 'app');
          }
        }
      } else {
        setPhase('idle');
        showToast(
          result.error?.includes('No guardians')
            ? t('emergency.startVoteNoGuardians')
            : t('emergency.startVoteFailed'),
          tc.orange,
        );
      }
    } catch {
      setPhase('idle');
      showToast(t('emergency.startVoteFailed'), tc.red);
    } finally {
      setVoteLoading(false);
    }
  };

  // ── Beneficiary: resend vote request ──────────────────────────────────────
  const handleResendVoteRequest = async () => {
    if (!ownerEmail || voteLoading) return;
    setVoteLoading(true);
    try {
      const result = await triggerStartVote(ownerEmail, beneficiaryName, legacy.ownerName ?? '');
      if (result.success) {
        addAuditEntry('vote_request_sent', 'app');
        showToast(t('emergency.voteSentToast'), tc.green);
        const status = await fetchGuardianVoteStatus(ownerEmail);
        if (status) setVoteStatus(status);
      } else {
        showToast(t('emergency.startVoteFailed'), tc.red);
      }
    } finally {
      setVoteLoading(false);
    }
  };

  // ── Owner: send vote request during voting phase ───────────────────────────
  const handleVoteRequest = async () => {
    if (!ownerEmail) { showToast(t('emergency.noOwnerEmail'), tc.orange); return; }
    const result = await triggerStartVote(ownerEmail, beneficiaryName, legacy.ownerName ?? '');
    if (result.success) {
      setVoteRequestSent(true);
      addAuditEntry('vote_request_sent', 'app');
      showToast(t('emergency.voteSentToast'), tc.green);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const status = await fetchGuardianVoteStatus(ownerEmail);
      if (status) setVoteStatus(status);
    } else if (result.error?.includes('No guardians')) {
      showToast(t('emergency.startVoteNoGuardians'), tc.orange);
    } else {
      showToast(t('emergency.startVoteFailed'), tc.red);
    }
  };

  // ── OTP: request code ──────────────────────────────────────────────────────
  const handleRequestOtp = async () => {
    if (!ownerEmail || otpLoading) return;
    setOtpLoading(true);
    try {
      const res = await authenticatedFetch(`${getApiBase()}/api/vault/request-otp/${encodeURIComponent(ownerEmail)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beneficiaryEmail: legacy.ownerEmail ?? '', ownerName }),
      });
      if (res.ok) {
        setOtpSent(true);
        addAuditEntry('otp_requested', 'app');
        showToast(t('emergency.otpResent'), tc.green);
      } else {
        showToast(t('emergency.otpResentFailed'), tc.red);
      }
    } catch {
      showToast(t('emergency.otpResentFailed'), tc.red);
    } finally {
      setOtpLoading(false);
    }
  };

  // ── OTP: verify and unlock vault ───────────────────────────────────────────
  const handleVerifyOtp = async () => {
    const code = otpCode.replace(/\s/g, '').trim();
    if (code.length < 6 || !ownerEmail || otpLoading) return;
    setOtpLoading(true);
    try {
      const res = await authenticatedFetch(`${getApiBase()}/api/vault/verify-otp/${encodeURIComponent(ownerEmail)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beneficiaryEmail: legacy.ownerEmail ?? '', otp: code }),
      });
      if (res.ok) {
        addAuditEntry('vault_otp_verified', 'app');
        addAuditEntry('vault_opened', 'app');
        setVaultUnlocked(true);
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast(t('emergency.vaultUnlocked'), tc.green);
      } else {
        showToast(t('emergency.otpInvalid'), tc.red);
      }
    } catch {
      showToast(t('emergency.otpInvalid'), tc.red);
    } finally {
      setOtpLoading(false);
    }
  };

  const activated = phase !== 'idle';
  const styles = useMemo(() => makeStyles(tc), [tc]);

  // ═══════════════════════════════════════════════════════════════════════════
  // BENEFICIARY VIEW — full-screen redesign
  // ═══════════════════════════════════════════════════════════════════════════
  if (isBeneficiaryRole) {
    const stepIndex = phase === 'idle' ? 0 : phase === 'voting' ? 1 : 2;
    const quorumMet = (voteStatus?.quorumReached ?? false) || phase === 'complete';

    const stepDefs = [
      { label: t('emergency.stepRequest'), activeColor: tc.red },
      { label: t('emergency.stepVote'), activeColor: tc.gold },
      { label: t('emergency.stepUnlock'), activeColor: tc.green },
    ];

    // Shared guardian rows renderer for voting + complete phases
    const renderGuardianRows = (vs: GuardianVoteStatus | null) => (
      <View style={styles.guardiansBlock}>
        <View style={styles.guardiansBlockHeader}>
          <Feather name="users" size={13} color={tc.textMuted} />
          <Text style={styles.guardiansBlockTitle}>{t('emergency.voteStatusTitle')}</Text>
          {vs && (
            <View style={[styles.tallyPill, { backgroundColor: quorumMet ? `${tc.green}20` : `${tc.gold}18`, borderColor: quorumMet ? `${tc.green}35` : `${tc.gold}35` }]}>
              <Text style={[styles.tallyPillText, { color: quorumMet ? tc.green : tc.gold }]}>
                {t('emergency.voteApprovals', { count: vs.approvals, n: vs.threshold })}
              </Text>
            </View>
          )}
        </View>
        {guardians.map((g, i) => {
          const decision = vs?.decisions.find(
            d => d.guardianEmail.toLowerCase() === g.email.toLowerCase()
          )?.decision ?? null;
          const dc = decision === 'approve' ? tc.green : decision === 'reject' ? tc.red : tc.gold;
          const dIcon: 'check-circle' | 'x-circle' | 'clock' =
            decision === 'approve' ? 'check-circle' : decision === 'reject' ? 'x-circle' : 'clock';
          const dLabel = decision === 'approve' ? t('emergency.voteApproved')
            : decision === 'reject' ? t('emergency.voteRejected')
            : t('emergency.votePending');
          return (
            <View
              key={g.id}
              style={[
                styles.guardianStatusRow,
                { borderLeftColor: dc },
                i > 0 && { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
              ]}
            >
              <View style={[styles.guardianStatusAvatar, { backgroundColor: `${g.avatarColor}22` }]}>
                <Text style={[styles.guardianStatusInitial, { color: g.avatarColor }]}>
                  {g.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.guardianStatusName}>{g.name}</Text>
                <Text style={styles.guardianStatusEmail} numberOfLines={1}>{g.email}</Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: `${dc}15`, borderColor: `${dc}30` }]}>
                <Feather name={dIcon} size={11} color={dc} />
                <Text style={[styles.statusPillText, { color: dc }]}>{dLabel}</Text>
              </View>
            </View>
          );
        })}
      </View>
    );

    return (
      <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
        <LinearGradient colors={['#0F0A1E', '#0A0F1E', '#0C1020']} style={StyleSheet.absoluteFill} />

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="x" size={20} color={tc.textSecondary} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Feather name="shield" size={14} color={tc.gold} style={{ marginRight: 6 }} />
            <Text style={styles.headerTitle}>{t('emergency.protocol')}</Text>
          </View>
          <View style={[styles.roleBadge, { backgroundColor: 'rgba(212,175,55,0.12)', borderColor: 'rgba(212,175,55,0.25)' }]}>
            <Text style={[styles.roleBadgeText, { color: tc.gold }]}>{t('emergency.roleBeneficiary')}</Text>
          </View>
        </View>

        {/* Toast */}
        {toast && (
          <View style={[styles.toastBanner, { backgroundColor: `${toast.color}15`, borderColor: `${toast.color}40` }]}>
            <Text style={[styles.toastText, { color: toast.color }]}>{toast.msg}</Text>
          </View>
        )}

        {/* Vault owner strip */}
        <View style={styles.ownerStrip}>
          <View style={[styles.ownerAvatar]}>
            <Text style={[styles.ownerAvatarText]}>{(ownerName || '?').charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.ownerStripName} numberOfLines={1}>{ownerName}</Text>
            <Text style={styles.ownerStripEmail} numberOfLines={1}>{ownerEmail || t('emergency.noOwnerEmail')}</Text>
          </View>
          <View style={styles.ownerStripBadge}>
            <Feather name="lock" size={9} color={tc.gold} />
            <Text style={styles.ownerStripBadgeText}>{t('emergency.ownerInfoTitle')}</Text>
          </View>
        </View>

        {/* Step progress */}
        <View style={styles.stepsContainer}>
          {stepDefs.map((step, i) => {
            const isDone = i < stepIndex;
            const isActive = i === stepIndex;
            const color = isDone ? tc.green : isActive ? step.activeColor : tc.textMuted;
            return (
              <React.Fragment key={i}>
                <View style={styles.stepItem}>
                  <View style={[
                    styles.stepBubble,
                    {
                      backgroundColor: isDone ? `${tc.green}20` : isActive ? `${color}20` : 'rgba(255,255,255,0.05)',
                      borderColor: isDone ? tc.green : isActive ? color : 'rgba(255,255,255,0.13)',
                    },
                  ]}>
                    {isDone
                      ? <Feather name="check" size={13} color={tc.green} />
                      : <Text style={[styles.stepNum, { color: isActive ? color : tc.textMuted }]}>{i + 1}</Text>
                    }
                  </View>
                  <Text style={[styles.stepLabel2, { color }]} numberOfLines={1}>{step.label}</Text>
                </View>
                {i < 2 && (
                  <View style={[styles.stepConnector, {
                    backgroundColor: i < stepIndex ? tc.green : 'rgba(255,255,255,0.10)',
                  }]} />
                )}
              </React.Fragment>
            );
          })}
        </View>

        {/* Phase content */}
        <ScrollView
          contentContainerStyle={[styles.benefBody, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── IDLE ──────────────────────────────────────────────────────── */}
          {phase === 'idle' && (
            <>
              <View style={[styles.phaseCard, { borderColor: 'rgba(239,68,68,0.28)', backgroundColor: 'rgba(239,68,68,0.07)' }]}>
                <View style={styles.phaseCardRow}>
                  <View style={[styles.phaseCardDot, { backgroundColor: tc.red }]} />
                  <Text style={styles.phaseCardTitle}>{t('emergency.protocol')}</Text>
                </View>
                <Text style={styles.phaseCardDesc}>{t('emergency.beneficiaryIdleDesc')}</Text>
                {!ownerEmail && (
                  <View style={styles.warnBox}>
                    <Feather name="alert-triangle" size={13} color={tc.orange} />
                    <Text style={styles.warnText}>{t('emergency.noOwnerEmail')}</Text>
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={[styles.ctaBtn, styles.ctaBtnRed, { opacity: (!ownerEmail || voteLoading) ? 0.5 : 1 }]}
                onPress={() => { void handleBeneficiaryActivate(); }}
                activeOpacity={0.85}
                disabled={!ownerEmail || voteLoading}
              >
                <Text style={styles.ctaBtnText}>
                  {voteLoading ? '···' : t('emergency.requestVoteBtn')}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── VOTING ────────────────────────────────────────────────────── */}
          {phase === 'voting' && (
            <>
              <View style={[styles.phaseCard, {
                borderColor: quorumMet ? 'rgba(34,197,94,0.35)' : 'rgba(212,175,55,0.28)',
                backgroundColor: quorumMet ? 'rgba(34,197,94,0.07)' : 'rgba(212,175,55,0.07)',
              }]}>
                <View style={styles.phaseCardRow}>
                  <View style={[styles.phaseCardDot, { backgroundColor: quorumMet ? tc.green : tc.gold }]} />
                  <Text style={[styles.phaseCardTitle, { color: quorumMet ? tc.green : tc.text }]}>
                    {quorumMet ? t('emergency.quorumReached') : t('legacy.phase2Title')}
                  </Text>
                </View>
                {voteStatus ? (
                  <View style={styles.tallyRow}>
                    <Text style={[styles.tallyBig, { color: quorumMet ? tc.green : tc.gold }]}>
                      {voteStatus.approvals}
                    </Text>
                    <Text style={styles.tallyOf}>/{voteStatus.threshold}</Text>
                    <Text style={styles.tallyDesc}>{' '}{t('emergency.stepVote')}</Text>
                  </View>
                ) : (
                  <Text style={styles.phaseCardDesc}>{t('emergency.votingInProgress')}</Text>
                )}
              </View>

              {renderGuardianRows(voteStatus)}

              {quorumMet ? (
                <TouchableOpacity
                  style={[styles.ctaBtn, styles.ctaBtnGreen, { opacity: otpLoading ? 0.6 : 1 }]}
                  onPress={() => { void handleRequestOtp(); }}
                  activeOpacity={0.85}
                  disabled={otpLoading}
                >
                  <Text style={[styles.ctaBtnText, styles.ctaBtnDarkText]}>
                    {otpLoading ? '···' : t('emergency.openVaultBtn')}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.resendLink}
                  onPress={() => { void handleResendVoteRequest(); }}
                  disabled={voteLoading}
                  activeOpacity={0.7}
                >
                  <Feather name="refresh-cw" size={12} color={tc.textMuted} />
                  <Text style={styles.resendLinkText}>{t('emergency.resendRequest')}</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* ── COMPLETE: open vault / request OTP ───────────────────────── */}
          {phase === 'complete' && !otpSent && (
            <>
              <View style={[styles.phaseCard, { borderColor: 'rgba(34,197,94,0.35)', backgroundColor: 'rgba(34,197,94,0.07)' }]}>
                <View style={styles.phaseCardRow}>
                  <View style={[styles.phaseCardDot, { backgroundColor: tc.green }]} />
                  <Text style={[styles.phaseCardTitle, { color: tc.green }]}>{t('emergency.phase3')}</Text>
                </View>
                <Text style={styles.phaseCardDesc}>{t('emergency.phase3Desc')}</Text>
              </View>

              {renderGuardianRows(voteStatus)}

              <TouchableOpacity
                style={[styles.ctaBtn, styles.ctaBtnGreen, { opacity: otpLoading ? 0.6 : 1 }]}
                onPress={() => { void handleRequestOtp(); }}
                activeOpacity={0.85}
                disabled={otpLoading}
              >
                <Text style={[styles.ctaBtnText, styles.ctaBtnDarkText]}>
                  {otpLoading ? '···' : t('emergency.openVaultBtn')}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── COMPLETE: OTP entry ───────────────────────────────────────── */}
          {phase === 'complete' && otpSent && !vaultUnlocked && (
            <>
              <View style={[styles.phaseCard, { borderColor: 'rgba(212,175,55,0.32)', backgroundColor: 'rgba(212,175,55,0.07)' }]}>
                <View style={styles.phaseCardRow}>
                  <Feather name="mail" size={15} color={tc.gold} />
                  <Text style={[styles.phaseCardTitle, { color: tc.gold, marginLeft: 8 }]}>{t('emergency.enterOtp')}</Text>
                </View>
                <Text style={styles.phaseCardDesc}>{t('emergency.phase3Desc')}</Text>
              </View>

              <View style={styles.otpBlock}>
                <TextInput
                  style={[styles.otpInput2, { color: tc.gold }]}
                  value={otpCode}
                  onChangeText={setOtpCode}
                  placeholder={t('emergency.otpPlaceholder')}
                  placeholderTextColor={tc.textMuted}
                  keyboardType="number-pad"
                  maxLength={7}
                  textAlign="center"
                  autoCorrect={false}
                  autoFocus
                />
              </View>

              <TouchableOpacity
                style={[styles.ctaBtn, styles.ctaBtnGold, {
                  opacity: otpCode.replace(/\s/g, '').length < 6 || otpLoading ? 0.5 : 1,
                }]}
                onPress={() => { void handleVerifyOtp(); }}
                activeOpacity={0.85}
                disabled={otpCode.replace(/\s/g, '').length < 6 || otpLoading}
              >
                <Text style={[styles.ctaBtnText, styles.ctaBtnDarkText]}>
                  {otpLoading ? '···' : t('emergency.verifyOtp')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.resendLink}
                onPress={() => { void handleRequestOtp(); }}
                disabled={otpLoading}
                activeOpacity={0.7}
              >
                <Feather name="refresh-cw" size={12} color={tc.textMuted} />
                <Text style={styles.resendLinkText}>{t('emergency.requestNewOtp')}</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── VAULT UNLOCKED ────────────────────────────────────────────── */}
          {vaultUnlocked && (
            <>
              <View style={[styles.phaseCard, {
                borderColor: 'rgba(34,197,94,0.40)',
                backgroundColor: 'rgba(34,197,94,0.09)',
                alignItems: 'center',
                gap: 14,
              }]}>
                <View style={styles.successIcon}>
                  <Feather name="check-circle" size={40} color={tc.green} />
                </View>
                <Text style={[styles.phaseCardTitle, { color: tc.green, textAlign: 'center', fontSize: 20 }]}>
                  {t('emergency.vaultUnlocked')}
                </Text>
                <Text style={[styles.phaseCardDesc, { textAlign: 'center' }]}>
                  {t('emergency.vaultUnlockedDesc')}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.ctaBtn, styles.ctaBtnGreen]}
                onPress={() => router.push('/received-vault')}
                activeOpacity={0.85}
              >
                <Text style={[styles.ctaBtnText, styles.ctaBtnDarkText]}>{t('emergency.viewVault')}</Text>
              </TouchableOpacity>
            </>
          )}

        </ScrollView>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OWNER VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
      <LinearGradient colors={['#1A0505', '#0D0818', '#0A0F1E']} style={StyleSheet.absoluteFill} />
      <Animated.View pointerEvents="none" style={[styles.ambientGlow, { opacity: activated ? glowOpacity : new Animated.Value(0.08) }]} />
      <ScreenGlow color="#EF4444" icon="zap" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="x" size={20} color={tc.textSecondary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Feather name="alert-triangle" size={14} color={tc.red} style={{ marginRight: 6 }} />
          <Text style={styles.headerTitle}>{t('emergency.protocol')}</Text>
        </View>
        <View style={[styles.backBtn, { backgroundColor: 'rgba(212,175,55,0.12)', borderColor: 'rgba(212,175,55,0.25)' }]}>
          <Feather name="shield" size={18} color={tc.gold} />
        </View>
      </View>

      {toast && (
        <View style={[styles.toastBanner, { backgroundColor: `${toast.color}15`, borderColor: `${toast.color}40` }]}>
          <Text style={[styles.toastText, { color: toast.color }]}>{toast.msg}</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        {/* Rings + circular button */}
        <View style={styles.ringsWrapper}>
          {activated && (
            <>
              <PulsingRing color={tc.red} size={SW * 0.88} delay={0} intensity={0.6} />
              <PulsingRing color={tc.red} size={SW * 0.68} delay={350} intensity={0.8} />
              <PulsingRing color="#FF6B6B" size={SW * 0.50} delay={700} intensity={1} />
            </>
          )}
          {!activated && (
            <>
              <PulsingRing color={tc.red} size={SW * 0.70} delay={0} intensity={0.25} />
              <PulsingRing color={tc.red} size={SW * 0.52} delay={500} intensity={0.3} />
            </>
          )}
          <Animated.View pointerEvents="box-none" style={[styles.btnOuter, { transform: [{ scale: scaleAnim }] }]}>
            <TouchableOpacity onPress={() => { void handleActivate(); }} activeOpacity={activated ? 1 : 0.85} disabled={activated}>
              <LinearGradient
                colors={activated ? ['#22C55E', '#16A34A'] : ['#EF4444', '#B91C1C']}
                style={styles.btnCircle}
              >
                <Feather name={activated ? 'check' : 'zap'} size={44} color="#fff" />
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* Idle */}
        {!activated && (
          <View style={styles.preActivate}>
            <Text style={styles.preTitle}>{t('emergency.activateProtocol')}</Text>
            <Text style={styles.preDesc}>
              {t('emergency.preDescFor')}{' '}
              <Text style={styles.nameHighlight}>{beneficiaryName}</Text>
              {`.\n`}
              {t('emergency.preDescActivate')}{' '}
              <Text style={styles.nameHighlight}>{ownerName}</Text>
              {t('emergency.preDescVault')}
            </Text>
            {guardians.length === 0 && (
              <View style={styles.warnBox}>
                <Feather name="alert-triangle" size={14} color={tc.orange} />
                <Text style={styles.warnText}>{t('emergency.noGuardians')}</Text>
              </View>
            )}
          </View>
        )}

        {/* Waiting */}
        {phase === 'waiting' && activatedAt && (
          <View style={styles.postActivate}>
            <View style={styles.statusCard}>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: tc.red }]} />
                <Text style={styles.statusTitle}>{t('emergency.phase1')}</Text>
              </View>
              <Text style={styles.statusLine}>
                {t('emergency.waitingFor', { owner: '' })}<Text style={{ color: tc.gold }}>{ownerName}</Text>:
              </Text>
              <Countdown from={deadline48h} />
              {ownerEmail ? (
                <View style={styles.notifRow}>
                  <Feather name="send" size={12} color={tc.blue} />
                  <Text style={styles.notifText}>{t('emergency.ownerNotifCount', { count: ownerNotifCount })}</Text>
                </View>
              ) : (
                <View style={styles.notifRow}>
                  <Feather name="alert-circle" size={12} color={tc.orange} />
                  <Text style={[styles.notifText, { color: tc.orange }]}>{t('emergency.noOwnerEmail')}</Text>
                </View>
              )}
              <View style={styles.divider} />
              <View style={styles.statusRow}>
                <Feather name="check-circle" size={14} color={tc.green} />
                <Text style={styles.statusLineGreen}>{t('emergency.guardiansNotified_other', { count: guardians.length })}</Text>
              </View>
              <View style={styles.statusRow}>
                <Feather name="info" size={14} color={tc.blue} />
                <Text style={styles.statusLineBlue}>{t('emergency.waitingComplete')}</Text>
              </View>
            </View>
            <View style={styles.stepsRow}>
              {[
                { icon: 'clock', label: t('emergency.step48h'), done: true, color: tc.red },
                { icon: 'users', label: t('emergency.stepVote'), done: false, color: tc.purple },
                { icon: 'unlock', label: t('emergency.stepUnlock'), done: false, color: tc.gold },
              ].map((step, i) => (
                <React.Fragment key={i}>
                  <View style={styles.step}>
                    <View style={[styles.stepIcon, { backgroundColor: `${step.color}20`, borderColor: `${step.color}40` }]}>
                      <Feather name={step.icon as any} size={16} color={step.color} />
                    </View>
                    <Text style={[styles.stepLabel, { color: step.done ? step.color : tc.textMuted }]}>{step.label}</Text>
                  </View>
                  {i < 2 && <View style={styles.stepLine} />}
                </React.Fragment>
              ))}
            </View>
            {guardians.length > 0 && <GuardiansList guardians={guardians} />}
          </View>
        )}

        {/* Voting */}
        {phase === 'voting' && (
          <View style={styles.postActivate}>
            <View style={[styles.statusCard, { borderColor: 'rgba(139,92,246,0.30)', backgroundColor: 'rgba(139,92,246,0.08)' }]}>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: tc.purple }]} />
                <Text style={styles.statusTitle}>{t('legacy.phase2Title')}</Text>
              </View>
              <Text style={[styles.statusLine, { marginLeft: 0 }]}>
                {t('emergency.phase2Desc', { m: legacy.mOfN.m, n: legacy.mOfN.n })}
              </Text>
              <View style={styles.divider} />
              {!voteRequestSent ? (
                <TouchableOpacity style={styles.voteBtn} onPress={() => { void handleVoteRequest(); }} activeOpacity={0.85}>
                  <LinearGradient colors={['#8B5CF6', '#6D28D9']} style={styles.voteBtnGrad}>
                    <Feather name="users" size={18} color="#fff" />
                    <Text style={styles.voteBtnText}>{t('emergency.sendVoteRequest')}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              ) : (
                <View style={styles.voteSentBadge}>
                  <Feather name="check-circle" size={14} color={tc.green} />
                  <Text style={styles.voteSentText}>{t('emergency.voteSentBadge')}</Text>
                </View>
              )}
            </View>
            <View style={styles.stepsRow}>
              {[
                { icon: 'clock', label: t('emergency.step48h'), done: true, color: tc.red },
                { icon: 'users', label: t('emergency.stepVote'), done: true, color: tc.purple },
                { icon: 'unlock', label: t('emergency.stepUnlock'), done: false, color: tc.gold },
              ].map((step, i) => (
                <React.Fragment key={i}>
                  <View style={styles.step}>
                    <View style={[styles.stepIcon, { backgroundColor: `${step.color}20`, borderColor: `${step.color}40` }]}>
                      <Feather name={step.icon as any} size={16} color={step.color} />
                    </View>
                    <Text style={[styles.stepLabel, { color: step.done ? step.color : tc.textMuted }]}>{step.label}</Text>
                  </View>
                  {i < 2 && <View style={styles.stepLine} />}
                </React.Fragment>
              ))}
            </View>
            {guardians.length > 0 && <GuardiansList guardians={guardians} voteStatus={voteStatus} />}
          </View>
        )}

        {/* Complete / OTP */}
        {phase === 'complete' && (
          <View style={styles.postActivate}>
            <View style={[styles.statusCard, { borderColor: 'rgba(212,175,55,0.35)', backgroundColor: 'rgba(212,175,55,0.08)' }]}>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: tc.gold }]} />
                <Text style={[styles.statusTitle, { color: tc.gold }]}>{t('emergency.phase3')}</Text>
              </View>
              <Text style={[styles.statusLine, { marginLeft: 0 }]}>{t('emergency.phase3Desc')}</Text>
            </View>
            <View style={styles.stepsRow}>
              {[
                { icon: 'clock', label: t('emergency.step48h'), done: true, color: tc.red },
                { icon: 'users', label: t('emergency.stepVote'), done: true, color: tc.purple },
                { icon: 'unlock', label: t('emergency.stepUnlock'), done: vaultUnlocked, color: tc.gold },
              ].map((step, i) => (
                <React.Fragment key={i}>
                  <View style={styles.step}>
                    <View style={[styles.stepIcon, { backgroundColor: `${step.color}20`, borderColor: `${step.color}40` }]}>
                      <Feather name={step.icon as any} size={16} color={step.color} />
                    </View>
                    <Text style={[styles.stepLabel, { color: step.done ? step.color : tc.textMuted }]}>{step.label}</Text>
                  </View>
                  {i < 2 && <View style={styles.stepLine} />}
                </React.Fragment>
              ))}
            </View>
            {!vaultUnlocked ? (
              <View style={[styles.statusCard, { borderColor: 'rgba(212,175,55,0.30)', backgroundColor: 'rgba(0,0,0,0.25)', gap: 14 }]}>
                <Text style={[styles.statusLine, { marginLeft: 0, color: tc.textSecondary, textAlign: 'center' }]}>
                  {t('emergency.enterOtp')}
                </Text>
                <View style={styles.otpRow}>
                  <TextInput
                    style={styles.otpInput}
                    value={otpCode}
                    onChangeText={setOtpCode}
                    placeholder={t('emergency.otpPlaceholder')}
                    placeholderTextColor={tc.textMuted}
                    keyboardType="number-pad"
                    maxLength={7}
                    textAlign="center"
                    autoCorrect={false}
                  />
                </View>
                <TouchableOpacity
                  style={[styles.voteBtn, { opacity: otpCode.replace(/\s/g, '').length < 6 || otpLoading ? 0.5 : 1 }]}
                  onPress={() => { void handleVerifyOtp(); }}
                  activeOpacity={0.85}
                  disabled={otpCode.replace(/\s/g, '').length < 6 || otpLoading}
                >
                  <LinearGradient colors={['#D4AF37', '#B8960C']} style={styles.voteBtnGrad}>
                    <Feather name="unlock" size={18} color="#0A0F1E" />
                    <Text style={[styles.voteBtnText, { color: '#0A0F1E' }]}>{t('emergency.verifyOtp')}</Text>
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { void handleRequestOtp(); }} activeOpacity={0.7} disabled={otpLoading} style={styles.resendOtpBtn}>
                  <Feather name="refresh-cw" size={12} color={tc.textMuted} />
                  <Text style={styles.resendOtpText}>{t('emergency.requestNewOtp')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={[styles.statusCard, { borderColor: 'rgba(34,197,94,0.35)', backgroundColor: 'rgba(34,197,94,0.08)', alignItems: 'center', gap: 12 }]}>
                <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: 'rgba(34,197,94,0.15)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.30)', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="check-circle" size={28} color={tc.green} />
                </View>
                <Text style={[styles.statusTitle, { color: tc.green, textAlign: 'center' }]}>{t('emergency.vaultUnlocked')}</Text>
                <Text style={[styles.statusLine, { marginLeft: 0, textAlign: 'center' }]}>{t('emergency.vaultUnlockedDesc')}</Text>
                <TouchableOpacity style={styles.voteBtn} onPress={() => router.push('/received-vault')} activeOpacity={0.85}>
                  <LinearGradient colors={['#22C55E', '#16A34A']} style={styles.voteBtnGrad}>
                    <Feather name="inbox" size={18} color="#fff" />
                    <Text style={styles.voteBtnText}>{t('emergency.viewVault')}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ── GuardiansList used in owner view ───────────────────────────────────────
function GuardiansList({ guardians, voteStatus }: {
  guardians: ReturnType<typeof useVault>['guardians'];
  voteStatus?: GuardianVoteStatus | null;
}) {
  const { colors: tc } = useTheme();
  const { t } = useLanguage();
  const styles = useMemo(() => makeStyles(tc), [tc]);

  const getVoteDecision = (email: string) => {
    if (!voteStatus) return null;
    return voteStatus.decisions.find(d => d.guardianEmail.toLowerCase() === email.toLowerCase())?.decision ?? null;
  };

  return (
    <View style={styles.guardiansCard}>
      <View style={styles.guardiansHeader}>
        <Feather name={voteStatus ? 'check-square' : 'mail'} size={14} color={voteStatus ? tc.purple : tc.blue} />
        <Text style={styles.guardiansTitle}>
          {voteStatus ? t('emergency.voteStatusTitle') : t('emergency.notifiedGuardians')}
        </Text>
        {voteStatus && (
          <View style={styles.voteCountBadge}>
            <Text style={styles.voteCountText}>
              {t('emergency.voteApprovals', { count: voteStatus.approvals, n: voteStatus.threshold })}
            </Text>
          </View>
        )}
      </View>
      {guardians.map((g, i) => {
        const decision = getVoteDecision(g.email);
        const decisionColor = decision === 'approve' ? tc.green : decision === 'reject' ? tc.red : tc.textMuted;
        const decisionIcon = decision === 'approve' ? 'check-circle' : decision === 'reject' ? 'x-circle' : 'clock';
        const decisionLabel = decision === 'approve' ? t('emergency.voteApproved')
          : decision === 'reject' ? t('emergency.voteRejected')
          : t('emergency.votePending');
        return (
          <View key={g.id} style={[styles.guardianRow, i > 0 && { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }]}>
            <View style={[styles.guardianAvatar, { backgroundColor: `${g.avatarColor}30` }]}>
              <Text style={[styles.guardianInitial, { color: g.avatarColor }]}>{g.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.guardianName}>{g.name}</Text>
              <Text style={styles.guardianEmail}>{g.email}</Text>
            </View>
            {voteStatus ? (
              <View style={[styles.sentBadge, { backgroundColor: `${decisionColor}15`, borderColor: `${decisionColor}30` }]}>
                <Feather name={decisionIcon as any} size={11} color={decisionColor} />
                <Text style={[styles.sentText, { color: decisionColor }]}>{decisionLabel}</Text>
              </View>
            ) : (
              <View style={styles.sentBadge}>
                <Feather name="check" size={10} color={tc.green} />
                <Text style={styles.sentText}>{t('emergency.sent')}</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  container: { flex: 1 },

  // ── Shared header ──────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12,
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold' },
  backBtn: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center',
  },
  roleBadge: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1,
  },
  roleBadgeText: { fontSize: 10, fontFamily: 'Poppins_600SemiBold' },

  // ── Toast ──────────────────────────────────────────────────────────────────
  toastBanner: {
    marginHorizontal: 20, marginBottom: 6,
    paddingVertical: 9, paddingHorizontal: 14,
    borderRadius: 12, borderWidth: 1,
  },
  toastText: { fontSize: 12, fontFamily: 'Poppins_400Regular', textAlign: 'center' },

  // ── Beneficiary: owner strip ───────────────────────────────────────────────
  ownerStrip: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 20, marginBottom: 12,
    backgroundColor: 'rgba(212,175,55,0.07)',
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.22)',
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, gap: 12,
  },
  ownerAvatar: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: 'rgba(212,175,55,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  ownerAvatarText: { fontSize: 18, fontWeight: '700', color: '#D4AF37', fontFamily: 'Poppins_700Bold' },
  ownerStripName: { fontSize: 13, fontWeight: '600', color: tc.text, fontFamily: 'Poppins_600SemiBold' },
  ownerStripEmail: { fontSize: 11, color: tc.textMuted, fontFamily: 'Poppins_400Regular', marginTop: 1 },
  ownerStripBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(212,175,55,0.14)', borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  ownerStripBadgeText: { fontSize: 9, color: '#D4AF37', fontFamily: 'Poppins_600SemiBold' },

  // ── Beneficiary: step progress bar ─────────────────────────────────────────
  stepsContainer: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 20, marginBottom: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 14, paddingHorizontal: 16,
  },
  stepItem: { flex: 1, alignItems: 'center', gap: 6 },
  stepBubble: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5,
  },
  stepNum: { fontSize: 13, fontWeight: '700', fontFamily: 'Poppins_700Bold' },
  stepLabel2: { fontSize: 9, fontFamily: 'Poppins_400Regular', textAlign: 'center' },
  stepConnector: { width: 24, height: 1.5, marginBottom: 14 },

  // ── Beneficiary: phase cards ───────────────────────────────────────────────
  benefBody: { paddingHorizontal: 20, paddingTop: 4, gap: 14 },
  phaseCard: {
    borderWidth: 1, borderRadius: 16, padding: 18, gap: 10,
  },
  phaseCardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  phaseCardDot: { width: 8, height: 8, borderRadius: 4 },
  phaseCardTitle: { fontSize: 15, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold', flex: 1 },
  phaseCardDesc: { fontSize: 13, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', lineHeight: 20 },

  // ── Vote tally row ─────────────────────────────────────────────────────────
  tallyRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2, marginTop: 2 },
  tallyBig: { fontSize: 32, fontWeight: '700', fontFamily: 'Poppins_700Bold' },
  tallyOf: { fontSize: 18, color: tc.textMuted, fontFamily: 'Poppins_400Regular' },
  tallyDesc: { fontSize: 13, color: tc.textSecondary, fontFamily: 'Poppins_400Regular' },
  tallyPill: {
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2,
    borderWidth: 1, alignSelf: 'flex-start',
  },
  tallyPillText: { fontSize: 10, fontFamily: 'Poppins_600SemiBold' },

  // ── Guardian status block (beneficiary view) ───────────────────────────────
  guardiansBlock: {
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)', borderRadius: 14, overflow: 'hidden',
  },
  guardiansBlockHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 16, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  guardiansBlockTitle: { fontSize: 12, fontWeight: '600', color: tc.textSecondary, fontFamily: 'Poppins_600SemiBold', flex: 1 },
  guardianStatusRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12, gap: 10,
    borderLeftWidth: 3,
  },
  guardianStatusAvatar: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  guardianStatusInitial: { fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' },
  guardianStatusName: { fontSize: 13, color: tc.text, fontFamily: 'Poppins_600SemiBold' },
  guardianStatusEmail: { fontSize: 11, color: tc.textMuted, fontFamily: 'Poppins_400Regular', marginTop: 1 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1,
  },
  statusPillText: { fontSize: 10, fontFamily: 'Poppins_600SemiBold' },

  // ── Full-width CTA buttons (beneficiary view) ──────────────────────────────
  ctaBtn: {
    width: '100%', borderRadius: 14,
    paddingVertical: 18, alignItems: 'center', justifyContent: 'center',
  },
  ctaBtnRed: { backgroundColor: '#EF4444' },
  ctaBtnGreen: { backgroundColor: '#22C55E' },
  ctaBtnGold: { backgroundColor: '#D4AF37' },
  ctaBtnText: {
    fontSize: 16, fontWeight: '700', color: '#fff',
    fontFamily: 'Poppins_700Bold', letterSpacing: 0.3,
  },
  ctaBtnDarkText: { color: '#0A0F1E' },

  // ── Resend link ────────────────────────────────────────────────────────────
  resendLink: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'center', paddingVertical: 8,
  },
  resendLinkText: { fontSize: 12, color: tc.textMuted, fontFamily: 'Poppins_400Regular' },

  // ── OTP block (beneficiary view) ───────────────────────────────────────────
  otpBlock: {
    width: '100%',
    backgroundColor: 'rgba(212,175,55,0.06)',
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(212,175,55,0.28)',
    overflow: 'hidden',
  },
  otpInput2: {
    paddingVertical: 20, paddingHorizontal: 20,
    fontSize: 32, fontWeight: '700',
    fontFamily: 'Poppins_700Bold',
    letterSpacing: 10, textAlign: 'center',
  },

  // ── Success icon ───────────────────────────────────────────────────────────
  successIcon: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: 'rgba(34,197,94,0.15)',
    borderWidth: 1, borderColor: 'rgba(34,197,94,0.30)',
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center',
  },

  // ── Warn box ───────────────────────────────────────────────────────────────
  warnBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4,
    backgroundColor: 'rgba(249,115,22,0.10)', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(249,115,22,0.28)',
    paddingVertical: 9, paddingHorizontal: 12,
  },
  warnText: { fontSize: 12, color: tc.orange, fontFamily: 'Poppins_400Regular', flex: 1 },

  // ── Owner view: ambient glow ───────────────────────────────────────────────
  ambientGlow: {
    position: 'absolute', top: 80, alignSelf: 'center',
    width: 320, height: 320, borderRadius: 160,
    backgroundColor: 'rgba(239,68,68,0.20)',
    pointerEvents: 'none',
  },

  // ── Owner view: body ───────────────────────────────────────────────────────
  body: { paddingHorizontal: 20, paddingTop: 8, alignItems: 'center' },
  ringsWrapper: {
    alignItems: 'center', justifyContent: 'center',
    width: SW * 0.88, height: SW * 0.72, marginBottom: 8,
  },
  btnOuter: {
    shadowColor: tc.red, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9, shadowRadius: 30, elevation: 20,
  },
  btnCircle: {
    width: 130, height: 130, borderRadius: 65,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(239,68,68,0.5)',
  },

  // ── Owner view: idle text ──────────────────────────────────────────────────
  preActivate: { alignItems: 'center', width: '100%', marginBottom: 24 },
  preTitle: { fontSize: 20, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold', marginBottom: 12, textAlign: 'center' },
  preDesc: { fontSize: 14, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22 },
  nameHighlight: { color: tc.gold, fontFamily: 'Poppins_600SemiBold' },

  // ── Owner view: post-activate ──────────────────────────────────────────────
  postActivate: { width: '100%', gap: 16 },
  statusCard: {
    backgroundColor: 'rgba(239,68,68,0.08)', borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)', borderRadius: 16, padding: 18, gap: 10,
  },
  statusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  statusTitle: { fontSize: 16, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold', flex: 1 },
  statusLine: { fontSize: 13, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', lineHeight: 20, marginLeft: 16 },
  statusLineGreen: { fontSize: 12, color: tc.green, fontFamily: 'Poppins_400Regular', flex: 1, lineHeight: 18 },
  statusLineBlue: { fontSize: 12, color: tc.blue, fontFamily: 'Poppins_400Regular', flex: 1, lineHeight: 18 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 4 },
  notifRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notifText: { fontSize: 12, color: tc.textMuted, fontFamily: 'Poppins_400Regular', flex: 1 },

  // ── Owner view: countdown ──────────────────────────────────────────────────
  countdown: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20, marginLeft: 16,
  },
  countdownCell: { alignItems: 'center', minWidth: 44 },
  countdownNum: {
    fontSize: 28, fontWeight: '700', color: tc.red,
    fontFamily: 'Poppins_700Bold', letterSpacing: 1,
    lineHeight: 38, includeFontPadding: false,
  },
  countdownLbl: {
    fontSize: 9, color: tc.textMuted, fontFamily: 'Poppins_400Regular',
    lineHeight: 14, includeFontPadding: false,
  },
  countdownSep: {
    fontSize: 24, color: tc.red, fontFamily: 'Poppins_700Bold',
    marginBottom: 10, includeFontPadding: false,
  },

  // ── Owner view: steps row ──────────────────────────────────────────────────
  stepsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 16, paddingHorizontal: 12, gap: 0,
  },
  step: { alignItems: 'center', gap: 6, flex: 1 },
  stepIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  stepLabel: { fontSize: 9, fontFamily: 'Poppins_400Regular', textAlign: 'center' },
  stepLine: { width: 24, height: 1, backgroundColor: 'rgba(255,255,255,0.12)' },

  // ── Owner view: vote button ────────────────────────────────────────────────
  voteBtn: { borderRadius: 14, overflow: 'hidden', marginTop: 4 },
  voteBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 20 },
  voteBtnText: { fontSize: 14, fontWeight: '700', color: '#fff', fontFamily: 'Poppins_700Bold' },
  voteSentBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(34,197,94,0.12)', borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 14,
    borderWidth: 1, borderColor: 'rgba(34,197,94,0.30)',
  },
  voteSentText: { fontSize: 13, color: tc.green, fontFamily: 'Poppins_600SemiBold', flex: 1 },

  // ── Owner view: guardians list ─────────────────────────────────────────────
  guardiansCard: {
    backgroundColor: 'rgba(59,130,246,0.08)', borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.20)', borderRadius: 16, overflow: 'hidden',
  },
  guardiansHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(59,130,246,0.15)',
  },
  guardiansTitle: { fontSize: 12, fontWeight: '600', color: tc.blue, fontFamily: 'Poppins_600SemiBold' },
  guardianRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 10 },
  guardianAvatar: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  guardianInitial: { fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' },
  guardianName: { fontSize: 13, color: tc.text, fontFamily: 'Poppins_600SemiBold' },
  guardianEmail: { fontSize: 11, color: tc.textMuted, fontFamily: 'Poppins_400Regular' },
  sentBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(34,197,94,0.15)', borderRadius: 8,
    paddingVertical: 3, paddingHorizontal: 7,
    borderWidth: 1, borderColor: 'rgba(34,197,94,0.30)',
  },
  sentText: { fontSize: 9, color: tc.green, fontFamily: 'Poppins_600SemiBold' },
  voteCountBadge: {
    marginLeft: 'auto' as any,
    backgroundColor: 'rgba(139,92,246,0.15)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(139,92,246,0.30)',
  },
  voteCountText: { fontSize: 10, color: tc.purple, fontFamily: 'Poppins_600SemiBold' },

  // ── Owner view: OTP ────────────────────────────────────────────────────────
  otpRow: {
    width: '100%',
    backgroundColor: 'rgba(212,175,55,0.06)',
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(212,175,55,0.30)',
    overflow: 'hidden',
  },
  otpInput: {
    paddingVertical: 16, paddingHorizontal: 20,
    fontSize: 26, fontWeight: '700',
    color: tc.gold, fontFamily: 'Poppins_700Bold',
    letterSpacing: 8, textAlign: 'center',
  },
  resendOtpBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginTop: 2,
  },
  resendOtpText: { fontSize: 11, color: tc.textMuted, fontFamily: 'Poppins_400Regular' },
});

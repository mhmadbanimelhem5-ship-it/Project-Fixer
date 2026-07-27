import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
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
import { useRouter } from 'expo-router';
import { unlockWithOtp } from '@/utils/legacyTransfer';
import { useTheme, ThemeColors } from '@/contexts/ThemeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVault } from '@/contexts/VaultContext';
import { ScreenGlow } from '@/components/shared/ScreenGlow';
import {
  initiateServerAbsenceProtocol,
  fetchServerAbsenceStatus,
  confirmAndStartGuardianVote,
  triggerStartVote,
  fetchGuardianVoteStatus,
  type GuardianVoteStatus,
} from '@/utils/emailApi';
import { getApiBase } from '@/utils/apiBase';

// ─── Setup modal ─────────────────────────────────────────────────────────────
function BeneficiarySetupModal({
  visible,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (ownerEmail: string, ownerName: string) => void;
}) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const styles = useMemo(() => makeStyles(c), [c]);

  const handleConfirm = () => {
    const trimmedEmail = ownerEmail.trim().toLowerCase();
    const trimmedName = ownerName.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      Alert.alert(t('emergency.invalidEmailTitle'), t('emergency.invalidEmailMsg'));
      return;
    }
    if (!trimmedName) {
      Alert.alert(t('emergency.nameRequiredTitle'), t('emergency.nameRequiredMsg'));
      return;
    }
    onConfirm(trimmedEmail, trimmedName);
    setOwnerEmail('');
    setOwnerName('');
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.7)' }]}
          onPress={() => { Keyboard.dismiss(); onClose(); }}
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <ScrollView
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={styles.modalIconWrapper}>
                <Feather name="user-check" size={28} color={c.red} />
              </View>
              <Text style={styles.modalTitle}>{t('emergency.beneficiaryModalTitle')}</Text>
              <Text style={styles.modalDesc}>{t('emergency.beneficiaryModalDesc')}</Text>

              <View style={styles.inputWrapper}>
                <Feather name="user" size={16} color={c.textMuted} style={{ marginLeft: 8 }} />
                <TextInput
                  style={styles.input}
                  placeholder={t('emergency.ownerNamePlaceholder')}
                  placeholderTextColor={c.textMuted}
                  value={ownerName}
                  onChangeText={setOwnerName}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="next"
                />
              </View>

              <View style={styles.inputWrapper}>
                <Feather name="mail" size={16} color={c.textMuted} style={{ marginLeft: 8 }} />
                <TextInput
                  style={styles.input}
                  placeholder={t('emergency.ownerEmailPlaceholder')}
                  placeholderTextColor={c.textMuted}
                  value={ownerEmail}
                  onChangeText={setOwnerEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleConfirm}
                />
              </View>

              <View style={styles.modalHint}>
                <Feather name="info" size={12} color={c.textMuted} />
                <Text style={styles.modalHintText}>{t('emergency.localStorageHint')}</Text>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.8}>
                  <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm} activeOpacity={0.85}>
                  <LinearGradient colors={['#EF4444', '#B91C1C']} style={styles.confirmBtnGrad}>
                    <Text style={styles.confirmBtnText}>{t('emergency.activateBtn')}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Countdown helper ─────────────────────────────────────────────────────────
const ABSENCE_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours

function formatCountdown(requestedAt: number): string {
  const remaining = Math.max(0, requestedAt + ABSENCE_WINDOW_MS - Date.now());
  const totalSecs = Math.floor(remaining / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── Main screen ─────────────────────────────────────────────────────────────
type TabPhase = 'idle' | 'awaiting_owner' | 'awaiting_confirm' | 'voting' | 'complete' | 'cancelled';

export default function EmergencyTabScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { legacy, updateLegacy, addAuditEntry } = useVault();
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [showSetupModal, setShowSetupModal] = useState(false);

  // ── Beneficiary vote flow state ──────────────────────────────────────────
  const [phase, setPhase] = useState<TabPhase>('idle');
  const [voteStatus, setVoteStatus] = useState<GuardianVoteStatus | null>(null);
  const [voteLoading, setVoteLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // countdown
  const [requestedAt, setRequestedAt] = useState<number | null>(null);
  const [countdown, setCountdown] = useState('');
  const didInit = useRef(false);

  const isBeneficiary = legacy.userRole === 'beneficiary';
  const ownerName = legacy.beneficiaryOwnerName || '';
  const ownerEmail = legacy.ownerEmail || '';

  useEffect(() => () => { if (toastRef.current) clearTimeout(toastRef.current); }, []);

  const showToast = useCallback((msg: string, color: string) => {
    setToast({ msg, color });
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // ── On mount: restore phase from server (handles app-reopen) ───────────
  const [ownerNotifCount, setOwnerNotifCount] = useState(0);
  useEffect(() => {
    if (!isBeneficiary || !ownerEmail || didInit.current) return;
    didInit.current = true;
    const init = async () => {
      const s = await fetchServerAbsenceStatus(ownerEmail);
      if (!s || s.status === 'none') return;
      if (s.ownerNotifCount !== undefined) setOwnerNotifCount(s.ownerNotifCount);
      if (s.requestedAt) setRequestedAt(s.requestedAt);
      if (s.status === 'pending_owner') {
        setPhase('awaiting_owner');
      } else if (s.status === 'pending_beneficiary_confirmation') {
        setPhase('awaiting_confirm');
      } else if (s.status === 'pending_guardian_vote') {
        setPhase('voting');
        const vs = await fetchGuardianVoteStatus(ownerEmail).catch(() => null);
        if (vs) setVoteStatus(vs);
      } else if (s.status === 'cancelled_by_owner') {
        setPhase('cancelled');
      } else if (s.status === 'guardian_approved' || s.status === 'guardian_rejected') {
        setPhase('complete');
        setOtpSent(true);
      }
    };
    void init().catch(() => {});
  }, [isBeneficiary, ownerEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Countdown ticker (awaiting_owner phase) ──────────────────────────────
  useEffect(() => {
    if (phase !== 'awaiting_owner' || requestedAt === null) return;
    const tick = () => setCountdown(formatCountdown(requestedAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, requestedAt]);

  // ── Poll owner response every 30s (awaiting_owner phase) ───────────────
  useEffect(() => {
    if (phase !== 'awaiting_owner' || !ownerEmail) return;
    const poll = async () => {
      const s = await fetchServerAbsenceStatus(ownerEmail);
      if (!s) return;
      if (s.ownerNotifCount !== undefined) setOwnerNotifCount(s.ownerNotifCount);
      if (s.requestedAt) setRequestedAt(s.requestedAt);
      if (s.status === 'cancelled_by_owner') {
        setPhase('cancelled');
        showToast(t('emergency.cancelledByOwner'), c.green);
        addAuditEntry('owner_confirmed_alive', 'app');
      } else if (s.status === 'pending_beneficiary_confirmation') {
        setPhase('awaiting_confirm');
        showToast(t('emergency.ownerAbsent48h'), c.orange);
        addAuditEntry('owner_absent_48h', 'app');
      } else if (s.status === 'pending_guardian_vote') {
        setPhase('voting');
      }
    };
    void poll().catch(() => {});
    const id = setInterval(() => void poll().catch(() => {}), 30_000);
    return () => clearInterval(id);
  }, [phase, ownerEmail, showToast, t, c.green, c.orange, addAuditEntry]);

  // ── Poll guardian vote status every 20s ─────────────────────────────────
  useEffect(() => {
    if (phase !== 'voting' || !ownerEmail) return;
    const poll = async () => {
      const status = await fetchGuardianVoteStatus(ownerEmail);
      if (!status) return;
      setVoteStatus(status);
      if (status.quorumReached) {
        setPhase('complete');
        setOtpSent(true);
        showToast(t('emergency.quorumTabToast'), c.green);
        addAuditEntry('guardian_quorum_reached', 'app');
      }
    };
    void poll().catch(() => {});
    const id = setInterval(() => void poll().catch(() => {}), 20_000);
    return () => clearInterval(id);
  }, [phase, ownerEmail, showToast, t, c.green, addAuditEntry]);

  // ── Handle setup modal confirm ────────────────────────────────────────────
  // Reset ALL phase state when ownerEmail changes so the init effect re-runs
  // for the new owner. Without this, changing the owner email leaves stale phase/
  // vote/countdown state from the previous owner visible.
  const handleBeneficiaryConfirm = (email: string, name: string) => {
    updateLegacy({ userRole: 'beneficiary', ownerEmail: email, beneficiaryOwnerName: name });
    setShowSetupModal(false);
    setPhase('idle');
    setVoteStatus(null);
    setOtpSent(false);
    setVaultUnlocked(false);
    setOwnerNotifCount(0);
    setRequestedAt(null);
    setCountdown('');
    didInit.current = false; // allow init effect to re-run for the new ownerEmail
  };

  // ── Toggle role: beneficiary ↔ owner ─────────────────────────────────────
  const handleToggleRole = () => {
    if (isBeneficiary) {
      updateLegacy({ userRole: 'owner', ownerEmail: undefined, beneficiaryOwnerName: undefined });
      setPhase('idle');
      setVoteStatus(null);
      setOtpSent(false);
      setVaultUnlocked(false);
      setOwnerNotifCount(0);
      setRequestedAt(null);
      setCountdown('');
      didInit.current = false; // allow init effect to re-run if role switches back
    } else {
      setShowSetupModal(true);
    }
  };

  // ── Start emergency protocol — notify owner first ────────────────────────
  const handleSendVoteRequest = async () => {
    if (!ownerEmail) { setShowSetupModal(true); return; }
    if (voteLoading) return;
    setVoteLoading(true);
    try {
      addAuditEntry('emergency_protocol_activated', 'app');
      const result = await initiateServerAbsenceProtocol(ownerEmail, '', ownerName);
      if (result.success) {
        setPhase('awaiting_owner');
        // Use server-returned count/timestamp (> 1 if request was reused), falling back to 1
        setOwnerNotifCount(result.ownerNotifCount ?? 1);
        if (result.requestedAt) setRequestedAt(result.requestedAt);
        addAuditEntry('owner_notification_sent', 'app');
        showToast(t('emergency.ownerNotificationSent'), c.gold);
      } else {
        showToast(
          result.error?.includes('No sealed vault')
            ? t('emergency.startVoteNoGuardians')
            : (result.error ?? t('emergency.startVoteFailed')),
          c.orange,
        );
      }
    } catch {
      showToast(t('emergency.startVoteFailed'), c.red);
    } finally {
      setVoteLoading(false);
    }
  };

  // ── Beneficiary confirms after 48h — start guardian voting ───────────────
  const handleConfirmProceed = async () => {
    if (!ownerEmail || voteLoading) return;
    setVoteLoading(true);
    try {
      const result = await confirmAndStartGuardianVote(ownerEmail);
      if (result.success) {
        setPhase('voting');
        addAuditEntry('vote_request_sent', 'app');
        showToast(t('emergency.voteSentToast'), c.green);
        const status = await fetchGuardianVoteStatus(ownerEmail);
        if (status) {
          setVoteStatus(status);
          if (status.quorumReached) {
            setPhase('complete');
            setOtpSent(true);
            addAuditEntry('guardian_quorum_reached', 'app');
          }
        }
      } else {
        showToast(result.error ?? t('emergency.startVoteFailed'), c.red);
      }
    } catch {
      showToast(t('emergency.startVoteFailed'), c.red);
    } finally {
      setVoteLoading(false);
    }
  };

  // ── Re-send guardian vote requests ────────────────────────────────────────
  // Uses triggerStartVote (not confirmAndStartGuardianVote) because at this point
  // the absence request status is already `pending_guardian_vote`, and
  // confirmAndStartGuardianVote requires `pending_beneficiary_confirmation`.
  const handleResend = async () => {
    if (!ownerEmail || voteLoading) return;
    setVoteLoading(true);
    try {
      const result = await triggerStartVote(ownerEmail, '', '');
      if (result.success) {
        showToast(t('emergency.voteSentToast'), c.green);
        addAuditEntry('vote_request_sent', 'app');
        const status = await fetchGuardianVoteStatus(ownerEmail);
        if (status) setVoteStatus(status);
      } else {
        showToast(t('emergency.startVoteFailed'), c.red);
      }
    } finally {
      setVoteLoading(false);
    }
  };

  // ── Beneficiary email (comes from server via vote-status) ────────────────
  const beneficiaryEmailFromServer = voteStatus?.beneficiaryEmail ?? '';

  // ── Request OTP (resend — OTP is already auto-sent by server on quorum) ──
  const handleRequestOtp = async () => {
    const bEmail = beneficiaryEmailFromServer;
    if (!ownerEmail || !bEmail || otpLoading) return;
    setOtpLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/vault/request-otp/${encodeURIComponent(ownerEmail)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beneficiaryEmail: bEmail, ownerName }),
      });
      if (res.ok) {
        setOtpSent(true);
        addAuditEntry('otp_requested', 'app');
        showToast(t('emergency.otpResent'), c.green);
      } else {
        showToast(t('emergency.otpResentFailed'), c.red);
      }
    } catch {
      showToast(t('emergency.otpResentFailed'), c.red);
    } finally {
      setOtpLoading(false);
    }
  };

  // ── Verify OTP ────────────────────────────────────────────────────────────
  // Uses unlockWithOtp (legacyTransfer) which:
  //   1. Verifies OTP with server (marks it used once)
  //   2. RSA-decrypts the transfer key with this device's private key
  //   3. AES-decrypts the vault snapshot
  //   4. Caches the result in SecureStore so received-vault screen reads it directly
  const handleVerifyOtp = async () => {
    const code = otpCode.replace(/\s/g, '').trim();
    const bEmail = beneficiaryEmailFromServer;
    if (code.length < 6 || !ownerEmail || otpLoading) return;
    // Guard after length check — show explicit error instead of silently doing nothing
    if (!bEmail) {
      showToast(t('emergency.startVoteFailed'), c.orange);
      return;
    }
    setOtpLoading(true);
    try {
      const result = await unlockWithOtp(ownerEmail, code, bEmail);
      if (result.success) {
        setVaultUnlocked(true);
        addAuditEntry('vault_otp_verified', 'app');
        addAuditEntry('vault_opened', 'app');
        showToast(t('emergency.vaultUnlocked'), c.green);
      } else {
        const msg = result.error ?? t('emergency.otpInvalid');
        showToast(msg, c.red);
      }
    } catch {
      showToast(t('emergency.otpInvalid'), c.red);
    } finally {
      setOtpLoading(false);
    }
  };

  // ── Owner (or guardian) view ──────────────────────────────────────────────
  if (!isBeneficiary) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
        <ScreenGlow color="#EF4444" icon="zap" />
        <ScrollView contentContainerStyle={styles.ownerScrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.infoCard}>
            <View style={styles.infoIconWrapper}>
              <Feather name="shield" size={40} color={c.purple} />
            </View>
            <Text style={styles.infoTitle}>{t('emergency.protocolTitle')}</Text>
            <Text style={styles.infoDesc}>{t('legacy.emergencyRoleInfo')}</Text>
            <View style={styles.roleBadge}>
              <Feather name="user" size={13} color={c.textMuted} />
              <Text style={styles.roleBadgeText}>
                {legacy.userRole === 'guardian' ? t('emergency.roleGuardian') : t('emergency.roleOwner')}
              </Text>
            </View>
          </View>

          {legacy.userRole === 'owner' && (
            <View style={styles.beneficiarySetupSection}>
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>{t('emergency.dividerOr')}</Text>
                <View style={styles.dividerLine} />
              </View>
              <TouchableOpacity style={styles.setBeneficiaryBtn} onPress={() => setShowSetupModal(true)} activeOpacity={0.85}>
                <LinearGradient
                  colors={['rgba(239,68,68,0.12)', 'rgba(185,28,28,0.08)']}
                  style={styles.setBeneficiaryGrad}
                >
                  <View style={styles.setBeneficiaryIcon}>
                    <Feather name="user-check" size={20} color={c.red} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.setBeneficiaryTitle}>{t('emergency.iAmBeneficiary')}</Text>
                    <Text style={styles.setBeneficiarySub}>{t('emergency.iAmBeneficiarySub')}</Text>
                  </View>
                  <Feather name="chevron-left" size={16} color={c.red} />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

        <BeneficiarySetupModal
          visible={showSetupModal}
          onClose={() => setShowSetupModal(false)}
          onConfirm={handleBeneficiaryConfirm}
        />
      </View>
    );
  }

  // ── Beneficiary view ──────────────────────────────────────────────────────
  const quorumMet = (voteStatus?.quorumReached ?? false) || phase === 'complete';

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
      <ScreenGlow color="#EF4444" icon="zap" />

      {/* Header */}
      <View style={styles.benefHeader}>
        <View style={styles.benefHeaderLeft}>
          <Feather name="shield" size={14} color={c.gold} />
          <Text style={styles.benefHeaderTitle}>{t('emergency.protocolTitle')}</Text>
        </View>
        <View style={styles.beneficiaryBadge}>
          <View style={styles.activeDot} />
          <Text style={styles.beneficiaryBadgeText}>{t('emergency.roleBeneficiary')}</Text>
        </View>
      </View>

      {/* Toast */}
      {toast && (
        <View style={[styles.toastBanner, { backgroundColor: `${toast.color}15`, borderColor: `${toast.color}40` }]}>
          <Text style={[styles.toastText, { color: toast.color }]}>{toast.msg}</Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={[styles.benefScrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Owner strip */}
        <View style={styles.ownerStrip}>
          <View style={styles.ownerStripAvatar}>
            <Text style={styles.ownerStripInitial}>
              {(ownerName || ownerEmail || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.ownerStripName} numberOfLines={1}>
              {ownerName || t('emergency.ownerInfoTitle')}
            </Text>
            <Text style={styles.ownerStripEmail} numberOfLines={1}>
              {ownerEmail || t('emergency.noOwnerEmail')}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.ownerStripEditBtn}
            onPress={() => setShowSetupModal(true)}
            activeOpacity={0.7}
          >
            <Feather name="edit-2" size={12} color={c.textMuted} />
          </TouchableOpacity>
        </View>

        {/* ── IDLE ──────────────────────────────────────────────────────── */}
        {phase === 'idle' && (
          <>
            <View style={[styles.phaseCard, { borderColor: 'rgba(239,68,68,0.28)', backgroundColor: 'rgba(239,68,68,0.07)' }]}>
              <View style={styles.phaseRow}>
                <View style={[styles.phaseDot, { backgroundColor: c.red }]} />
                <Text style={styles.phaseTitle}>{t('emergency.protocol')}</Text>
              </View>
              <Text style={styles.phaseDesc}>{t('emergency.beneficiaryIdleDesc')}</Text>
            </View>

            <TouchableOpacity
              style={[styles.ctaBtn, styles.ctaBtnRed]}
              onPress={() => { void handleSendVoteRequest(); }}
              activeOpacity={0.85}
              disabled={voteLoading}
            >
              <Text style={styles.ctaBtnText}>
                {voteLoading ? '···' : t('emergency.requestVoteBtn')}
              </Text>
            </TouchableOpacity>

            {!ownerEmail && (
              <View style={styles.warnBox}>
                <Feather name="alert-triangle" size={13} color={c.orange} />
                <Text style={styles.warnText}>{t('emergency.noOwnerEmail')}</Text>
              </View>
            )}
          </>
        )}

        {/* ── AWAITING OWNER (48h countdown) ────────────────────────────── */}
        {phase === 'awaiting_owner' && (
          <>
            {/* Header card */}
            <View style={[styles.phaseCard, { borderColor: 'rgba(212,175,55,0.32)', backgroundColor: 'rgba(212,175,55,0.06)', alignItems: 'center' }]}>
              <View style={[styles.phaseRow, { justifyContent: 'center', marginBottom: 6 }]}>
                <View style={[styles.phaseDot, { backgroundColor: c.gold }]} />
                <Text style={[styles.phaseTitle, { color: c.gold }]}>{t('emergency.protocolActivated')}</Text>
              </View>
              <Text style={[styles.phaseDesc, { textAlign: 'center', marginBottom: 18 }]}>
                {t('emergency.ownerAbsenceWaiting')}
              </Text>

              {/* Countdown display */}
              <View style={[styles.countdownBox, { borderColor: `${c.gold}40` }]}>
                <Text style={[styles.countdownTime, { color: c.gold }]}>
                  {countdown || '48:00:00'}
                </Text>
                <Text style={[styles.countdownSub, { color: c.textMuted }]}>
                  {t('emergency.timeRemaining48h')}
                </Text>
              </View>

              {/* Privacy note */}
              <View style={[styles.privacyNote, { borderColor: `${c.gold}25`, backgroundColor: `${c.gold}08` }]}>
                <Feather name="shield" size={13} color={c.gold} style={{ marginTop: 1 }} />
                <Text style={[styles.privacyNoteText, { color: c.gold }]}>
                  {t('emergency.patiencePrivacyNote')}
                </Text>
              </View>

              {/* Notification count + polling indicator */}
              <View style={[styles.tallyRow, { marginTop: 12 }]}>
                <Feather name="bell" size={12} color={c.textMuted} />
                <Text style={[styles.tallyLabel, { marginLeft: 5 }]}>
                  {t('emergency.notifCountLabel', { count: ownerNotifCount })}
                </Text>
              </View>
              <View style={styles.pollRow}>
                <Feather name="refresh-cw" size={10} color={c.textMuted} />
                <Text style={styles.pollText}>{t('emergency.pollingEvery30s')}</Text>
              </View>
            </View>
          </>
        )}

        {/* ── AWAITING BENEFICIARY CONFIRM ──────────────────────────────── */}
        {phase === 'awaiting_confirm' && (
          <>
            <View style={[styles.phaseCard, { borderColor: 'rgba(239,68,68,0.32)', backgroundColor: 'rgba(239,68,68,0.07)' }]}>
              <View style={styles.phaseRow}>
                <View style={[styles.phaseDot, { backgroundColor: c.red }]} />
                <Text style={[styles.phaseTitle, { color: c.red }]}>{t('emergency.awaitingConfirmTitle')}</Text>
              </View>
              <Text style={styles.phaseDesc}>{t('emergency.awaitingConfirmDesc')}</Text>
              <View style={[styles.tallyRow, { marginTop: 10 }]}>
                <Feather name="bell-off" size={13} color={c.red} />
                <Text style={[styles.tallyLabel, { color: c.red, marginLeft: 6 }]}>
                  {t('emergency.notifCountLabel', { count: ownerNotifCount || 16 })}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.ctaBtn, styles.ctaBtnRed, { opacity: voteLoading ? 0.6 : 1 }]}
              onPress={() => { void handleConfirmProceed(); }}
              activeOpacity={0.85}
              disabled={voteLoading}
            >
              <Text style={styles.ctaBtnText}>
                {voteLoading ? '···' : t('emergency.proceedToVoteBtn')}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── CANCELLED ─────────────────────────────────────────────────── */}
        {phase === 'cancelled' && (
          <>
            <View style={[styles.phaseCard, { borderColor: 'rgba(34,197,94,0.32)', backgroundColor: 'rgba(34,197,94,0.07)' }]}>
              <View style={styles.successIconWrap}>
                <Feather name="check-circle" size={26} color={c.green} />
              </View>
              <Text style={[styles.phaseTitle, { color: c.green, textAlign: 'center', marginTop: 8 }]}>
                {t('emergency.cancelledTitle')}
              </Text>
              <Text style={[styles.phaseDesc, { textAlign: 'center' }]}>
                {t('emergency.cancelledDesc')}
              </Text>
            </View>

            <TouchableOpacity onPress={handleToggleRole} activeOpacity={0.7} style={[styles.resetRoleBtn, { marginTop: 16 }]}>
              <Feather name="refresh-ccw" size={12} color={c.textMuted} />
              <Text style={styles.resetRoleText}>{t('emergency.changeRole')}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── VOTING ────────────────────────────────────────────────────── */}
        {phase === 'voting' && (
          <>
            {/* "Guardian voting started" announcement banner */}
            {!quorumMet && (
              <View style={styles.votingStartedBanner}>
                <View style={styles.votingStartedIconRow}>
                  <Feather name="users" size={22} color={c.gold} />
                </View>
                <Text style={[styles.votingStartedTitle, { color: c.gold }]}>
                  {t('emergency.guardianVotingStarted')}
                </Text>
                <Text style={styles.votingStartedDesc}>
                  {t('emergency.guardianVotingStartedDesc')}
                </Text>
              </View>
            )}

            <View style={[styles.phaseCard, {
              borderColor: quorumMet ? 'rgba(34,197,94,0.35)' : 'rgba(212,175,55,0.28)',
              backgroundColor: quorumMet ? 'rgba(34,197,94,0.07)' : 'rgba(212,175,55,0.07)',
            }]}>
              <View style={styles.phaseRow}>
                <View style={[styles.phaseDot, { backgroundColor: quorumMet ? c.green : c.gold }]} />
                <Text style={[styles.phaseTitle, { color: quorumMet ? c.green : c.text }]}>
                  {quorumMet ? t('emergency.quorumReached') : t('legacy.phase2Title')}
                </Text>
              </View>
              {voteStatus ? (
                <View style={styles.tallyRow}>
                  <Text style={[styles.tallyBig, { color: quorumMet ? c.green : c.gold }]}>
                    {voteStatus.approvals}
                  </Text>
                  <Text style={styles.tallySlash}>/{voteStatus.threshold}</Text>
                  <Text style={styles.tallyLabel}>{' '}{t('emergency.stepVote')}</Text>
                </View>
              ) : (
                <Text style={styles.phaseDesc}>{t('emergency.votingInProgress')}</Text>
              )}
              <View style={styles.pollRow}>
                <Feather name="refresh-cw" size={10} color={c.textMuted} />
                <Text style={styles.pollText}>{t('emergency.pollingEvery20s')}</Text>
              </View>
            </View>

            {/* Guardian status cards */}
            {voteStatus && voteStatus.decisions.length > 0 && (
              <View style={styles.guardiansBlock}>
                <View style={styles.guardiansBlockHeader}>
                  <Feather name="users" size={13} color={c.textMuted} />
                  <Text style={styles.guardiansBlockTitle}>{t('emergency.voteStatusTitle')}</Text>
                  <View style={[styles.tallyPill, {
                    backgroundColor: quorumMet ? `${c.green}20` : `${c.gold}18`,
                    borderColor: quorumMet ? `${c.green}35` : `${c.gold}35`,
                  }]}>
                    <Text style={[styles.tallyPillText, { color: quorumMet ? c.green : c.gold }]}>
                      {voteStatus.approvals}/{voteStatus.threshold}
                    </Text>
                  </View>
                </View>
                {voteStatus.decisions.map((d, i) => {
                  const dc = d.decision === 'approve' ? c.green : d.decision === 'reject' ? c.red : c.gold;
                  const dIcon: 'check-circle' | 'x-circle' | 'clock' =
                    d.decision === 'approve' ? 'check-circle' : d.decision === 'reject' ? 'x-circle' : 'clock';
                  const dLabel = d.decision === 'approve' ? t('emergency.voteApproved')
                    : d.decision === 'reject' ? t('emergency.voteRejected')
                    : t('emergency.votePending');
                  const displayName = d.guardianEmail.split('@')[0] ?? d.guardianEmail;
                  const initial = displayName.charAt(0).toUpperCase();
                  return (
                    <View
                      key={d.guardianEmail}
                      style={[
                        styles.guardianRow,
                        { borderLeftColor: dc },
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

            {/* Resend link */}
            <TouchableOpacity style={styles.resendLink} onPress={() => void handleResend()} disabled={voteLoading} activeOpacity={0.7}>
              <Feather name="refresh-cw" size={12} color={c.textMuted} />
              <Text style={styles.resendLinkText}>{t('emergency.resendRequest')}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── COMPLETE: quorum success card ─────────────────────────────── */}
        {phase === 'complete' && (
          <>
            {/* Success notification */}
            <View style={[styles.successCard]}>
              <View style={styles.successIconWrap}>
                <Feather name="check-circle" size={26} color={c.green} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.phaseTitle, { color: c.green }]}>{t('emergency.quorumReached')}</Text>
                <Text style={styles.phaseDesc}>{t('emergency.quorumTabToast')}</Text>
              </View>
            </View>

            {/* Guardian votes final state */}
            {voteStatus && voteStatus.decisions.length > 0 && (
              <View style={styles.guardiansBlock}>
                <View style={styles.guardiansBlockHeader}>
                  <Feather name="users" size={13} color={c.textMuted} />
                  <Text style={styles.guardiansBlockTitle}>{t('emergency.voteStatusTitle')}</Text>
                  <View style={[styles.tallyPill, { backgroundColor: `${c.green}20`, borderColor: `${c.green}35` }]}>
                    <Text style={[styles.tallyPillText, { color: c.green }]}>
                      {voteStatus.approvals}/{voteStatus.threshold}
                    </Text>
                  </View>
                </View>
                {voteStatus.decisions.map((d, i) => {
                  const dc = d.decision === 'approve' ? c.green : d.decision === 'reject' ? c.red : c.gold;
                  const dIcon: 'check-circle' | 'x-circle' | 'clock' =
                    d.decision === 'approve' ? 'check-circle' : d.decision === 'reject' ? 'x-circle' : 'clock';
                  const dLabel = d.decision === 'approve' ? t('emergency.voteApproved')
                    : d.decision === 'reject' ? t('emergency.voteRejected')
                    : t('emergency.votePending');
                  const displayName = d.guardianEmail.split('@')[0] ?? d.guardianEmail;
                  const initial = displayName.charAt(0).toUpperCase();
                  return (
                    <View
                      key={d.guardianEmail}
                      style={[
                        styles.guardianRow,
                        { borderLeftColor: dc },
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

            {/* OTP request */}
            {!otpSent && !vaultUnlocked && (
              <TouchableOpacity
                style={[styles.ctaBtn, styles.ctaBtnGreen, { opacity: otpLoading ? 0.6 : 1 }]}
                onPress={() => void handleRequestOtp()}
                activeOpacity={0.85}
                disabled={otpLoading}
              >
                <Text style={[styles.ctaBtnText, { color: '#0A0F1E' }]}>
                  {otpLoading ? '···' : t('emergency.openVaultBtn')}
                </Text>
              </TouchableOpacity>
            )}

            {/* OTP input */}
            {otpSent && !vaultUnlocked && (
              <>
                <View style={[styles.phaseCard, { borderColor: 'rgba(212,175,55,0.32)', backgroundColor: 'rgba(212,175,55,0.07)' }]}>
                  <View style={styles.phaseRow}>
                    <Feather name="mail" size={15} color={c.gold} />
                    <Text style={[styles.phaseTitle, { color: c.gold, marginLeft: 8 }]}>{t('emergency.enterOtp')}</Text>
                  </View>
                  <Text style={styles.phaseDesc}>{t('emergency.phase3Desc')}</Text>
                </View>

                <View style={styles.otpBlock}>
                  <TextInput
                    style={[styles.otpInput, { color: c.gold }]}
                    value={otpCode}
                    onChangeText={setOtpCode}
                    placeholder={t('emergency.otpPlaceholder')}
                    placeholderTextColor={c.textMuted}
                    keyboardType="number-pad"
                    maxLength={7}
                    textAlign="center"
                    autoFocus
                  />
                </View>

                <TouchableOpacity
                  style={[styles.ctaBtn, styles.ctaBtnGold, {
                    opacity: otpCode.replace(/\s/g, '').length < 6 || otpLoading ? 0.5 : 1,
                  }]}
                  onPress={() => void handleVerifyOtp()}
                  activeOpacity={0.85}
                  disabled={otpCode.replace(/\s/g, '').length < 6 || otpLoading}
                >
                  <Text style={[styles.ctaBtnText, { color: '#0A0F1E' }]}>
                    {otpLoading ? '···' : t('emergency.verifyOtp')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.resendLink} onPress={() => void handleRequestOtp()} disabled={otpLoading} activeOpacity={0.7}>
                  <Feather name="refresh-cw" size={12} color={c.textMuted} />
                  <Text style={styles.resendLinkText}>{t('emergency.requestNewOtp')}</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Vault unlocked */}
            {vaultUnlocked && (
              <>
                <View style={[styles.phaseCard, { borderColor: 'rgba(34,197,94,0.40)', backgroundColor: 'rgba(34,197,94,0.09)', alignItems: 'center', gap: 12 }]}>
                  <View style={styles.unlockIcon}>
                    <Feather name="check-circle" size={36} color={c.green} />
                  </View>
                  <Text style={[styles.phaseTitle, { color: c.green, textAlign: 'center' }]}>{t('emergency.vaultUnlocked')}</Text>
                  <Text style={[styles.phaseDesc, { textAlign: 'center' }]}>{t('emergency.vaultUnlockedDesc')}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.ctaBtn, styles.ctaBtnGreen]}
                  onPress={() => router.push(`/received-vault?owner=${encodeURIComponent(ownerEmail)}`)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.ctaBtnText, { color: '#0A0F1E' }]}>{t('emergency.viewVault')}</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Divider + receive vault */}
            {!vaultUnlocked && (
              <>
                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>{t('emergency.dividerOr')}</Text>
                  <View style={styles.dividerLine} />
                </View>
                <TouchableOpacity style={styles.receiveBtn} onPress={() => router.push('/received-vault')} activeOpacity={0.85}>
                  <LinearGradient colors={['rgba(212,175,55,0.15)', 'rgba(139,92,246,0.12)']} style={styles.receiveBtnGrad}>
                    <View style={styles.receiveBtnIcon}>
                      <Feather name="inbox" size={20} color={c.gold} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.receiveBtnTitle}>{t('emergency.receiveVaultTitle')}</Text>
                      <Text style={styles.receiveBtnSub}>{t('emergency.receiveVaultSub')}</Text>
                    </View>
                    <Feather name="chevron-left" size={16} color={c.textMuted} />
                  </LinearGradient>
                </TouchableOpacity>
              </>
            )}
          </>
        )}

        {/* Idle: receive vault + divider */}
        {phase === 'idle' && (
          <>
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>{t('emergency.dividerOr')}</Text>
              <View style={styles.dividerLine} />
            </View>
            <TouchableOpacity style={styles.receiveBtn} onPress={() => router.push('/received-vault')} activeOpacity={0.85}>
              <LinearGradient colors={['rgba(212,175,55,0.15)', 'rgba(139,92,246,0.12)']} style={styles.receiveBtnGrad}>
                <View style={styles.receiveBtnIcon}>
                  <Feather name="inbox" size={20} color={c.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.receiveBtnTitle}>{t('emergency.receiveVaultTitle')}</Text>
                  <Text style={styles.receiveBtnSub}>{t('emergency.receiveVaultSub')}</Text>
                </View>
                <Feather name="chevron-left" size={16} color={c.textMuted} />
              </LinearGradient>
            </TouchableOpacity>
          </>
        )}

        {/* Role toggle */}
        <TouchableOpacity onPress={handleToggleRole} activeOpacity={0.7} style={styles.resetRoleBtn}>
          <Feather name="refresh-ccw" size={12} color={c.textMuted} />
          <Text style={styles.resetRoleText}>{t('emergency.changeRole')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <BeneficiarySetupModal
        visible={showSetupModal}
        onClose={() => setShowSetupModal(false)}
        onConfirm={handleBeneficiaryConfirm}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  // Owner view
  ownerScrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  infoCard: {
    marginHorizontal: 8, padding: 28, borderRadius: 24, width: '100%',
    backgroundColor: 'rgba(139,92,246,0.08)', borderWidth: 1, borderColor: 'rgba(139,92,246,0.20)',
    alignItems: 'center', gap: 12,
  },
  infoIconWrapper: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: 'rgba(139,92,246,0.15)', borderWidth: 1, borderColor: 'rgba(139,92,246,0.30)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  infoTitle: { fontSize: 18, fontWeight: '700', color: c.text, fontFamily: 'Poppins_700Bold', textAlign: 'center' },
  infoDesc: { fontSize: 13, color: c.textSecondary, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22 },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.glass, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: c.glassBorder, marginTop: 4,
  },
  roleBadgeText: { fontSize: 12, color: c.textMuted, fontFamily: 'Poppins_400Regular' },
  beneficiarySetupSection: { width: '100%', gap: 16 },
  setBeneficiaryBtn: { width: '100%', borderRadius: 18, overflow: 'hidden' },
  setBeneficiaryGrad: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)', borderRadius: 18,
  },
  setBeneficiaryIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: 'rgba(239,68,68,0.12)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  setBeneficiaryTitle: { fontSize: 14, fontWeight: '700', color: c.red, fontFamily: 'Poppins_700Bold' },
  setBeneficiarySub: { fontSize: 11, color: c.textSecondary, fontFamily: 'Poppins_400Regular', marginTop: 2 },

  // Beneficiary header
  benefHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
  },
  benefHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  benefHeaderTitle: { fontSize: 15, fontWeight: '700', color: c.text, fontFamily: 'Poppins_700Bold' },
  beneficiaryBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(239,68,68,0.10)', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
  },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.red },
  beneficiaryBadgeText: { fontSize: 11, color: c.red, fontFamily: 'Poppins_600SemiBold' },

  // Toast
  toastBanner: {
    marginHorizontal: 20, marginBottom: 6,
    paddingVertical: 10, paddingHorizontal: 16,
    borderRadius: 12, borderWidth: 1,
  },
  toastText: { fontSize: 12, fontFamily: 'Poppins_400Regular', textAlign: 'center' },

  // Scroll content
  benefScrollContent: { paddingHorizontal: 20, paddingTop: 4, gap: 14 },

  // Owner strip
  ownerStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(212,175,55,0.07)', borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.22)', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  ownerStripAvatar: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(212,175,55,0.18)', alignItems: 'center', justifyContent: 'center',
  },
  ownerStripInitial: { fontSize: 18, fontWeight: '700', color: '#D4AF37', fontFamily: 'Poppins_700Bold' },
  ownerStripName: { fontSize: 13, fontWeight: '600', color: c.text, fontFamily: 'Poppins_600SemiBold' },
  ownerStripEmail: { fontSize: 11, color: c.textMuted, fontFamily: 'Poppins_400Regular', marginTop: 1 },
  ownerStripEditBtn: {
    width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  ownerStripBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(212,175,55,0.14)', borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  ownerStripBadgeText: { fontSize: 9, color: '#D4AF37', fontFamily: 'Poppins_600SemiBold' },

  // Countdown (awaiting_owner)
  countdownBox: {
    borderWidth: 1, borderRadius: 20, paddingVertical: 20, paddingHorizontal: 32,
    alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.25)',
  },
  countdownTime: {
    fontSize: 46, fontWeight: '700', fontFamily: 'Poppins_700Bold',
    letterSpacing: 3, lineHeight: 54,
  },
  countdownSub: { fontSize: 11, fontFamily: 'Poppins_400Regular' },
  privacyNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderWidth: 1, borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 14, marginTop: 4,
  },
  privacyNoteText: {
    fontSize: 12, fontFamily: 'Poppins_400Regular', flex: 1, lineHeight: 18,
  },

  // Voting started banner
  votingStartedBanner: {
    borderWidth: 1, borderRadius: 16, padding: 20,
    borderColor: 'rgba(212,175,55,0.35)', backgroundColor: 'rgba(212,175,55,0.07)',
    alignItems: 'center', gap: 8,
  },
  votingStartedIconRow: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: 'rgba(212,175,55,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  votingStartedTitle: {
    fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center',
  },
  votingStartedDesc: {
    fontSize: 12, color: c.textSecondary, fontFamily: 'Poppins_400Regular',
    textAlign: 'center', lineHeight: 19,
  },

  // Phase cards
  phaseCard: { borderWidth: 1, borderRadius: 16, padding: 18, gap: 10 },
  phaseRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  phaseDot: { width: 8, height: 8, borderRadius: 4 },
  phaseTitle: { fontSize: 15, fontWeight: '700', color: c.text, fontFamily: 'Poppins_700Bold', flex: 1 },
  phaseDesc: { fontSize: 13, color: c.textSecondary, fontFamily: 'Poppins_400Regular', lineHeight: 20 },

  // Tally
  tallyRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  tallyBig: { fontSize: 30, fontWeight: '700', fontFamily: 'Poppins_700Bold' },
  tallySlash: { fontSize: 16, color: c.textMuted, fontFamily: 'Poppins_400Regular' },
  tallyLabel: { fontSize: 12, color: c.textSecondary, fontFamily: 'Poppins_400Regular' },
  tallyPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1 },
  tallyPillText: { fontSize: 10, fontFamily: 'Poppins_600SemiBold' },

  // Poll indicator
  pollRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  pollText: { fontSize: 10, color: c.textMuted, fontFamily: 'Poppins_400Regular' },

  // Guardians block
  guardiansBlock: {
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)', borderRadius: 14, overflow: 'hidden',
  },
  guardiansBlockHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 16, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  guardiansBlockTitle: { fontSize: 12, fontWeight: '600', color: c.textSecondary, fontFamily: 'Poppins_600SemiBold', flex: 1 },
  guardianRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12, gap: 10,
    borderLeftWidth: 3,
  },
  guardianAvatar: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  guardianInitial: { fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' },
  guardianName: { fontSize: 13, color: c.text, fontFamily: 'Poppins_600SemiBold' },
  guardianEmail: { fontSize: 11, color: c.textMuted, fontFamily: 'Poppins_400Regular', marginTop: 1 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1,
  },
  statusPillText: { fontSize: 10, fontFamily: 'Poppins_600SemiBold' },

  // CTA buttons
  ctaBtn: {
    width: '100%', borderRadius: 14, paddingVertical: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaBtnRed: { backgroundColor: '#EF4444' },
  ctaBtnGreen: { backgroundColor: '#22C55E' },
  ctaBtnGold: { backgroundColor: '#D4AF37' },
  ctaBtnText: { fontSize: 16, fontWeight: '700', color: '#fff', fontFamily: 'Poppins_700Bold', letterSpacing: 0.3 },

  // Warn
  warnBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(249,115,22,0.10)', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(249,115,22,0.28)',
    paddingVertical: 9, paddingHorizontal: 12,
  },
  warnText: { fontSize: 12, color: c.orange, fontFamily: 'Poppins_400Regular', flex: 1 },

  // Resend link
  resendLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingVertical: 6 },
  resendLinkText: { fontSize: 12, color: c.textMuted, fontFamily: 'Poppins_400Regular' },

  // Success card
  successCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 14,
    backgroundColor: 'rgba(34,197,94,0.09)', borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.35)', borderRadius: 16, padding: 18,
  },
  successIconWrap: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: 'rgba(34,197,94,0.15)', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(34,197,94,0.30)', flexShrink: 0,
  },
  unlockIcon: {
    width: 64, height: 64, borderRadius: 18,
    backgroundColor: 'rgba(34,197,94,0.15)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.30)',
    alignItems: 'center', justifyContent: 'center',
  },

  // OTP
  otpBlock: {
    width: '100%', backgroundColor: 'rgba(212,175,55,0.06)',
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(212,175,55,0.28)',
    overflow: 'hidden',
  },
  otpInput: {
    paddingVertical: 20, paddingHorizontal: 20,
    fontSize: 30, fontWeight: '700', fontFamily: 'Poppins_700Bold',
    letterSpacing: 10, textAlign: 'center',
  },

  // Receive vault
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%' },
  dividerLine: { flex: 1, height: 1, backgroundColor: c.separator },
  dividerText: { fontSize: 11, color: c.textMuted, fontFamily: 'Poppins_400Regular' },
  receiveBtn: { width: '100%', borderRadius: 18, overflow: 'hidden' },
  receiveBtnGrad: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)', borderRadius: 18,
  },
  receiveBtnIcon: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: 'rgba(212,175,55,0.15)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.30)',
    alignItems: 'center', justifyContent: 'center',
  },
  receiveBtnTitle: { fontSize: 14, fontWeight: '700', color: c.text, fontFamily: 'Poppins_700Bold' },
  receiveBtnSub: { fontSize: 11, color: c.textSecondary, fontFamily: 'Poppins_400Regular', marginTop: 2 },

  // Role toggle
  resetRoleBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'center', paddingVertical: 8 },
  resetRoleText: { fontSize: 11, color: c.textMuted, fontFamily: 'Poppins_400Regular' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#0F172A', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 16, paddingHorizontal: 0, borderWidth: 1, borderBottomWidth: 0,
    borderColor: 'rgba(239,68,68,0.20)', maxHeight: '92%',
  },
  modalScrollContent: { paddingHorizontal: 28, paddingBottom: 36, alignItems: 'center', gap: 12 },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', marginBottom: 8 },
  modalIconWrapper: {
    width: 60, height: 60, borderRadius: 18,
    backgroundColor: 'rgba(239,68,68,0.12)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.30)',
    alignItems: 'center', justifyContent: 'center',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#F1F5F9', fontFamily: 'Poppins_700Bold', textAlign: 'center' },
  modalDesc: { fontSize: 13, color: '#94A3B8', fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22 },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)', borderRadius: 14,
    paddingVertical: 4, paddingHorizontal: 4, width: '100%',
  },
  input: {
    flex: 1, paddingHorizontal: 12, paddingVertical: 12,
    color: '#F1F5F9', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'right',
  },
  modalHint: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  modalHintText: { fontSize: 11, color: '#475569', fontFamily: 'Poppins_400Regular' },
  modalActions: { flexDirection: 'row', gap: 12, width: '100%', marginTop: 4 },
  cancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 14, color: '#94A3B8', fontFamily: 'Poppins_600SemiBold' },
  confirmBtn: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  confirmBtnGrad: { paddingVertical: 14, alignItems: 'center' },
  confirmBtnText: { fontSize: 14, color: '#fff', fontFamily: 'Poppins_700Bold' },
});

/**
 * legacy.tsx — Digital Legacy Screen
 *
 * Allows the vault owner to configure and trigger the three-layer cryptographic
 * legacy transfer so their beneficiary can inherit the vault after an absence.
 *
 * ─── Three-layer architecture (configured here, executed in legacyTransfer.ts) ───
 *
 *   Layer 1 — AES-256 (CryptoJS)
 *     Vault items are decrypted with the owner's PIN-derived key, then
 *     re-encrypted with a fresh random 32-byte Transfer Key (TK).
 *     The AES blob is stored on the server — it cannot be opened without TK.
 *
 *   Layer 2 — RSA-OAEP-2048 (keyManager.ts)
 *     TK is encrypted with the beneficiary's RSA public key (registered when
 *     they first opened Auryx on their device).  Only their device can decrypt
 *     it.  This is the "إغلاق الخزنة" button's direct-access path.
 *
 *   Layer 3 — Shamir Secret Sharing (shamirUtils.ts)
 *     TK is also split into N guardian shares, threshold K = mOfN.m.
 *     Each share is RSA-encrypted with the guardian's own public key.
 *     If the beneficiary didn't register their key in time, K guardians can
 *     vote to reconstruct TK via Shamir combination.
 *
 * ─── What "إغلاق الخزنة الآن" does (NOT end-of-session) ────────────────────
 *
 *   • Builds a cryptographic snapshot of the current vault contents.
 *   • Seals it with the three layers above.
 *   • Uploads the sealed package to the server.
 *   • The owner's own vault is NOT affected — they can keep using it normally.
 *   • The button can be pressed again at any time to refresh the sealed package
 *     with the latest vault contents.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { GlassCard } from '@/components/GlassCard';
import { HexagonLogo } from '@/components/HexagonLogo';
import { useVault } from '@/contexts/VaultContext';
import type { AbsenceDays } from '@/contexts/VaultContext';
import { useLanguage } from '@/contexts/LanguageContext';
import colors from '@/constants/colors';
import { useTheme, ThemeColors } from '@/contexts/ThemeContext';
import { ScreenGlow } from '@/components/shared/ScreenGlow';
import { inviteBeneficiary, notifyBeneficiaryRemoved, checkInviteStatus } from '@/utils/emailApi';
import type { SealResult } from '@/utils/legacyTransfer';
import { useNetwork } from '@/contexts/NetworkContext';
import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';

const ABSENCE_DAYS: AbsenceDays[] = [7, 14, 30, 60, 90];
const ROW1: AbsenceDays[] = [7, 14, 30];
const ROW2: AbsenceDays[] = [60, 90];

// ── Small reusable components ─────────────────────────────────────────────────

function LegacyFeature({ icon, title, subtitle, color }: {
  icon: string; title: string; subtitle: string; color: string;
}) {
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <View style={styles.feature}>
      <View style={[styles.featureIcon, { backgroundColor: `${color}20`, borderColor: `${color}40` }]}>
        <Feather name={icon as any} size={22} color={color} />
      </View>
      <Text style={[styles.featureTitle, { color }]}>{title}</Text>
      <Text style={styles.featureSub}>{subtitle}</Text>
    </View>
  );
}

/** A single row inside the SealSuccessSheet. */
function SealRow({ icon, label, sublabel, color, ok }: {
  icon: string; label: string; sublabel?: string; color: string; ok: boolean;
}) {
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <View style={successStyles.row}>
      <View style={[successStyles.rowIcon, { backgroundColor: `${color}20` }]}>
        <Feather name={icon as any} size={16} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[successStyles.rowLabel, { color: ok ? tc.text : tc.textMuted }]}>
          {label}
        </Text>
        {sublabel ? (
          <Text style={[successStyles.rowSublabel, { color: ok ? tc.green : tc.orange }]}>
            {sublabel}
          </Text>
        ) : null}
      </View>
      <Feather
        name={ok ? 'check-circle' : 'alert-triangle'}
        size={16}
        color={ok ? tc.green : tc.orange}
      />
    </View>
  );
}

// ── Seal Success Sheet ────────────────────────────────────────────────────────

/**
 * Bottom-sheet shown after a successful seal operation.
 * Displays a breakdown of each encryption layer so the user understands
 * exactly what happened and who has access to the sealed package.
 */
function SealSuccessSheet({
  visible,
  onClose,
  result,
  beneficiaryName,
  guardianCount,
  mOfN,
  itemCount,
  sealedAt,
}: {
  visible: boolean;
  onClose: () => void;
  result: SealResult;
  beneficiaryName: string;
  guardianCount: number;
  mOfN: { m: number; n: number };
  itemCount: number;
  sealedAt: number;
}) {
  const { t, language } = useLanguage();
  const locale = language === 'ar' ? 'ar' : 'en';
  const timeStr = new Date(sealedAt).toLocaleTimeString(locale, {
    hour: '2-digit', minute: '2-digit',
  });
  const dateStr = new Date(sealedAt).toLocaleDateString(locale, {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />

          {/* ── Header ── */}
          <View style={successStyles.iconWrap}>
            <LinearGradient
              colors={['rgba(212,175,55,0.25)', 'rgba(212,175,55,0.08)']}
              style={successStyles.iconCircle}
            >
              <Feather name="lock" size={30} color={tc.gold} />
            </LinearGradient>
          </View>
          <Text style={successStyles.title}>{t('legacy.sealSuccessTitle')}</Text>
          <Text style={successStyles.timestamp}>{dateStr}  ·  {timeStr}</Text>
          <Text style={successStyles.subtitle}>{t('legacy.sealSuccessSubtitle')}</Text>

          {/* ── Layer breakdown ── */}
          <View style={successStyles.layersBox}>
            <SealRow
              icon="database"
              color={tc.blue}
              label={t('legacy.layer1Label', { count: itemCount })}
              sublabel={t('legacy.layer1SubLabel')}
              ok
            />
            <SealRow
              icon="key"
              color={tc.purple}
              label={t('legacy.layer2Label')}
              sublabel={result.beneficiaryKeyIncluded
                ? t('legacy.layer2SubOk', { name: beneficiaryName })
                : t('legacy.layer2SubFail')}
              ok={result.beneficiaryKeyIncluded}
            />
            <SealRow
              icon="users"
              color={tc.gold}
              label={t('legacy.layer3Label', { m: mOfN.m, n: guardianCount })}
              sublabel={t('legacy.layer3Sub', { m: mOfN.m, n: guardianCount })}
              ok={guardianCount >= mOfN.m}
            />
          </View>

          {/* ── Missing guardian keys warning ── */}
          {result.missingKeys && result.missingKeys.length > 0 && (
            <View style={successStyles.warnBox}>
              <Feather name="alert-triangle" size={13} color={tc.orange} />
              <Text style={successStyles.warnText}>
                {t('legacy.missingKeysWarn', { count: result.missingKeys.length })}{'\n'}
                {result.missingKeys.join('  ·  ')}
              </Text>
            </View>
          )}

          {/* ── Close button ── */}
          <TouchableOpacity style={styles.modalConfirm} onPress={onClose}>
            <LinearGradient colors={['#D4AF37', '#B8960C']} style={styles.modalConfirmGrad}>
              <Text style={styles.modalConfirmText}>{t('legacy.understood')}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Beneficiary Modal ─────────────────────────────────────────────────────────

function BeneficiaryModal({ visible, onClose, onSave }: {
  visible: boolean; onClose: () => void;
  onSave: (name: string, email: string) => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

  const handleSave = () => {
    if (!name.trim() || !email.trim()) return;
    if (!isValidEmail(email.trim())) return;
    onSave(name.trim(), email.trim());
    setName(''); setEmail('');
    onClose();
  };

  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('legacy.beneficiary')}</Text>
            <Text style={styles.modalSub}>{t('legacy.beneficiarySub')}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder={t('legacy.fullNamePlaceholder')}
              placeholderTextColor={tc.textMuted}
              value={name}
              onChangeText={setName}
              autoCorrect={false}
              spellCheck={false}
              autoCapitalize="words"
              returnKeyType="next"
            />
            <TextInput
              style={styles.modalInput}
              placeholder={t('legacy.emailPlaceholder2')}
              placeholderTextColor={tc.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={onClose}>
                <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleSave}>
                <LinearGradient colors={['#D4AF37', '#B8960C']} style={styles.modalConfirmGrad}>
                  <Text style={styles.modalConfirmText}>{t('common.save')}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Legacy Setup Onboarding Modal ─────────────────────────────────────────────

const ONBOARDING_STORE_KEY = 'legacy_onboarding_seen_v1';

interface OnboardingStep {
  icon: string;
  color: string;
  titleKey: string;
  descKey: string;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  { icon: 'users',      color: '#60A5FA', titleKey: 'legacy.setupStep1Title', descKey: 'legacy.setupStep1Desc' },
  { icon: 'user-check', color: '#A78BFA', titleKey: 'legacy.setupStep2Title', descKey: 'legacy.setupStep2Desc' },
  { icon: 'clock',      color: '#F59E0B', titleKey: 'legacy.setupStep3Title', descKey: 'legacy.setupStep3Desc' },
  { icon: 'lock',       color: '#D4AF37', titleKey: 'legacy.setupStep4Title', descKey: 'legacy.setupStep4Desc' },
  { icon: 'refresh-cw', color: '#34D399', titleKey: 'legacy.setupStep5Title', descKey: 'legacy.setupStep5Desc' },
];

function LegacyOnboardingModal({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  const { colors: tc } = useTheme();
  const { t } = useLanguage();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={onboardStyles.overlay}>
        <View style={[onboardStyles.sheet, { backgroundColor: '#0D0818', borderColor: 'rgba(212,175,55,0.25)' }]}>
          {/* Header */}
          <LinearGradient
            colors={['rgba(212,175,55,0.18)', 'transparent']}
            style={onboardStyles.headerGrad}
          >
            <View style={onboardStyles.iconWrap}>
              <Feather name="shield" size={28} color={tc.gold} />
            </View>
            <Text style={[onboardStyles.title, { color: tc.gold }]}>{t('legacy.setupGuideTitle')}</Text>
            <Text style={[onboardStyles.subtitle, { color: tc.textSecondary }]}>{t('legacy.setupGuideSubtitle')}</Text>
          </LinearGradient>

          {/* Steps */}
          <ScrollView
            style={onboardStyles.scroll}
            contentContainerStyle={onboardStyles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {ONBOARDING_STEPS.map((step) => (
              <View key={step.titleKey} style={[onboardStyles.stepRow, { borderColor: `${step.color}25` }]}>
                <View style={[onboardStyles.stepIcon, { backgroundColor: `${step.color}18`, borderColor: `${step.color}35` }]}>
                  <Feather name={step.icon as any} size={18} color={step.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[onboardStyles.stepTitle, { color: step.color }]}>{t(step.titleKey)}</Text>
                  <Text style={[onboardStyles.stepDesc, { color: tc.textSecondary }]}>{t(step.descKey)}</Text>
                </View>
              </View>
            ))}

            {/* Disclaimer */}
            <View style={[onboardStyles.disclaimer, { backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.28)' }]}>
              <View style={onboardStyles.disclaimerHeader}>
                <Feather name="alert-triangle" size={14} color="#EF4444" />
                <Text style={[onboardStyles.disclaimerTitle, { color: '#EF4444' }]}>{t('legacy.setupDisclaimerTitle')}</Text>
              </View>
              <Text style={[onboardStyles.disclaimerText, { color: tc.textMuted }]}>{t('legacy.setupDisclaimerText')}</Text>
            </View>
          </ScrollView>

          {/* CTA */}
          <TouchableOpacity
            style={[onboardStyles.cta, { backgroundColor: tc.gold }]}
            onPress={onDismiss}
            activeOpacity={0.85}
          >
            <Feather name="check-circle" size={18} color="#0A0F1E" style={{ marginRight: 8 }} />
            <Text style={[onboardStyles.ctaText, { color: '#0A0F1E' }]}>{t('legacy.setupUnderstood')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const onboardStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    height: '88%',
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  headerGrad: {
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 20,
    paddingHorizontal: 24,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(212,175,55,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
    writingDirection: 'rtl',
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    writingDirection: 'rtl',
  },
  scroll: { flex: 1, flexGrow: 1, flexShrink: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  stepIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 3,
    writingDirection: 'rtl',
  },
  stepDesc: {
    fontSize: 12,
    lineHeight: 18,
    writingDirection: 'rtl',
  },
  disclaimer: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginTop: 6,
    marginBottom: 4,
  },
  disclaimerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 7,
  },
  disclaimerTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  disclaimerText: {
    fontSize: 11.5,
    lineHeight: 18,
    writingDirection: 'rtl',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    margin: 16,
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
  },
  ctaText: {
    fontSize: 15,
    fontWeight: '700',
  },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

type SealState = 'idle' | 'loading' | 'done' | 'error';

export default function LegacyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useLanguage();

  const { legacy, updateLegacy, sealVaultForLegacy, keyReady, keyError, keyErrorMsg, retryKeyGeneration, guardians, items } = useVault();
  const { recheckConnectivity } = useNetwork();

  const [showBeneficiaryModal, setShowBeneficiaryModal] = useState(false);
  const [toast, setToast] = useState<{ msg: string; color?: string } | null>(null);
  const [isRetryingNet, setIsRetryingNet] = useState(false);

  // Seal state machine
  const [sealState, setSealState] = useState<SealState>('idle');
  const [sealError, setSealError] = useState('');
  const [sealPhaseIdx, setSealPhaseIdx] = useState(0);
  const [sealResult, setSealResult] = useState<SealResult | null>(null);
  const [sealedAt, setSealedAt] = useState(0);
  const [showSealSuccess, setShowSealSuccess] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const phaseTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const sealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track previous keyReady so we only toast on the false→true transition
  const prevKeyReadyRef = useRef(false);
  const pollBeneficiaryRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Elapsed counter shown in the "generating key" banner while keyReady=false
  const [keyGenElapsed, setKeyGenElapsed] = useState(0);
  const keyGenTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!keyReady && !keyError) {
      setKeyGenElapsed(0);
      keyGenTimerRef.current = setInterval(() => setKeyGenElapsed(s => s + 1), 1000);
    } else {
      if (keyGenTimerRef.current) { clearInterval(keyGenTimerRef.current); keyGenTimerRef.current = null; }
    }
    return () => { if (keyGenTimerRef.current) { clearInterval(keyGenTimerRef.current); keyGenTimerRef.current = null; } };
  }, [keyReady, keyError]);

  const showToast = useCallback((msg: string, color = tc.green) => {
    setToast({ msg, color });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const clearPhaseTimers = () => {
    phaseTimers.current.forEach(clearTimeout);
    phaseTimers.current = [];
  };

  // Show onboarding guide the first time the user visits this screen
  useEffect(() => {
    SecureStore.getItemAsync(ONBOARDING_STORE_KEY).then((val) => {
      if (!val) setShowOnboarding(true);
    }).catch(() => setShowOnboarding(true));
  }, []);

  const handleOnboardingDismiss = useCallback(async () => {
    setShowOnboarding(false);
    try { await SecureStore.setItemAsync(ONBOARDING_STORE_KEY, '1'); } catch {}
  }, []);

  // Clean up timers on unmount
  useEffect(() => () => {
    clearPhaseTimers();
    if (sealTimeoutRef.current) clearTimeout(sealTimeoutRef.current);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (pollBeneficiaryRef.current) clearInterval(pollBeneficiaryRef.current);
  }, []);

  // Poll beneficiary invite status every 60s while status is 'pending'
  useEffect(() => {
    const token = legacy.beneficiary?.inviteToken;
    const status = legacy.beneficiary?.inviteStatus;
    if (!token || status !== 'pending') {
      if (pollBeneficiaryRef.current) {
        clearInterval(pollBeneficiaryRef.current);
        pollBeneficiaryRef.current = null;
      }
      return;
    }
    let cancelled = false;
    const check = async () => {
      if (cancelled || !legacy.beneficiary?.inviteToken) return;
      const res = await checkInviteStatus(legacy.beneficiary.inviteToken);
      if (cancelled) return;
      if (res.status === 'accepted' || res.status === 'rejected') {
        const b = legacy.beneficiary;
        if (b) {
          updateLegacy({ beneficiary: { ...b, inviteStatus: res.status } });
        }
        if (pollBeneficiaryRef.current) {
          clearInterval(pollBeneficiaryRef.current);
          pollBeneficiaryRef.current = null;
        }
        if (res.status === 'accepted') {
          showToast(t('legacy.beneficiaryAccepted', { name: legacy.beneficiary?.name ?? t('legacy.beneficiary') }), tc.green);
        } else {
          showToast(t('legacy.beneficiaryRejected', { name: legacy.beneficiary?.name ?? t('legacy.beneficiary') }), tc.red);
        }
      }
    };
    if (pollBeneficiaryRef.current) clearInterval(pollBeneficiaryRef.current);
    check();
    pollBeneficiaryRef.current = setInterval(check, 60_000);
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacy.beneficiary?.inviteToken, legacy.beneficiary?.inviteStatus]);

  // Show success toast the moment RSA key generation finishes
  useEffect(() => {
    if (keyReady && !prevKeyReadyRef.current) {
      showToast(t('legacy.keyGenSuccess'), tc.green);
    }
    prevKeyReadyRef.current = keyReady;
  }, [keyReady, showToast, t]);

  /**
   * Retry RSA key generation with a live connectivity pre-check.
   *
   * Flow:
   *   1. Call NetInfo.fetch() to get the freshest network state (bypasses any
   *      cached `isConnected` value that might be stale after a flap).
   *   2. If offline → show orange toast and return; nothing else happens.
   *   3. If online  → update NetworkContext state via recheckConnectivity so the
   *      rest of the app also sees the fresh status, then kick off key generation.
   *   4. retryKeyGeneration now returns Promise<boolean> — we await it here so
   *      we can show an explicit success/failure toast without relying on a
   *      separate useEffect transition watcher.
   */
  const handleRetryKey = useCallback(async () => {
    if (isRetryingNet) return;
    setIsRetryingNet(true);
    showToast(t('legacy.checkingConnection'), tc.purple);
    try {
      const state = await NetInfo.fetch();
      const online =
        state.isConnected !== false &&
        (Platform.OS === 'web' || state.isInternetReachable !== false);
      // Sync NetworkContext so OfflineScreen and other guards see fresh state
      recheckConnectivity();
      if (!online) {
        showToast(t('legacy.noInternet'), tc.orange);
        return;
      }
      // Awaiting retryKeyGeneration keeps isRetryingNet=true while the key is
      // being generated, so the error box stays hidden (keyError=false) and the
      // generating spinner is visible until we get a definitive result.
      showToast(t('legacy.generatingKey'), tc.purple);
      const success = await retryKeyGeneration(legacy.ownerEmail ?? '');
      if (success) {
        showToast(t('legacy.keyGenSuccess'), '#22c55e');
      } else {
        showToast(t('legacy.keyGenFailed'), tc.orange);
      }
    } catch {
      showToast(t('legacy.connectionCheckFailed'), tc.orange);
    } finally {
      setIsRetryingNet(false);
    }
  }, [isRetryingNet, recheckConnectivity, retryKeyGeneration, legacy.ownerEmail, showToast]);

  const handleDaysSelect = (days: AbsenceDays) => {
    updateLegacy({ absenceDays: days });
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSaveBeneficiary = (name: string, email: string) => {
    const previous = legacy.beneficiary;
    const beneficiaryChanged = previous && previous.email && previous.email !== email;
    if (beneficiaryChanged) {
      const ownerName = legacy.ownerName || t('legacy.ownerDefault');
      notifyBeneficiaryRemoved(legacy.ownerEmail || '', ownerName, previous!.email).catch(() => {});
    }

    // Save locally first (no status yet — will update to 'pending' once API responds).
    // ⚠️ DO NOT call retryKeyGeneration here: node-forge RSA blocks the JS thread
    //    for 30-120s on ARM devices, preventing the autosave debounce from firing →
    //    data is never written to SecureStore → beneficiary disappears on force-close.
    //    RSA is already handled by the post-onboarding useEffect in VaultContext.
    updateLegacy({ beneficiary: { name, email }, enabled: true, lastActiveAt: Date.now() });
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Send invite in the background — fire-and-forget so the UI is never frozen.
    // After API responds, persist the invite token + status so the badge can update.
    const ownerName = legacy.ownerName || t('legacy.ownerDefault');
    showToast(t('legacy.inviteSending', { email }));
    inviteBeneficiary(legacy.ownerEmail || '', ownerName, name, email, '').then(result => {
      if (result.success) {
        updateLegacy({
          beneficiary: { name, email, inviteStatus: 'pending', inviteToken: result.token },
        });
        showToast(t('legacy.inviteSent2', { email }));
      } else {
        showToast(t('legacy.savedLocally'), tc.orange);
      }
    }).catch(() => {
      showToast(t('legacy.savedLocally'), tc.orange);
    });
  };

  const handleDeleteBeneficiary = () => {
    const msg = t('legacy.confirmDeleteBeneficiary');
    if (Platform.OS === 'web') {
      if (!confirm(msg)) return;
      doDeleteBeneficiary();
    } else {
      Alert.alert(t('legacy.deleteBeneficiary'), msg, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: doDeleteBeneficiary },
      ]);
    }
  };

  const doDeleteBeneficiary = () => {
    const b = legacy.beneficiary;
    if (!b) return;
    const ownerName = legacy.ownerName || t('legacy.ownerDefault');
    notifyBeneficiaryRemoved(legacy.ownerEmail || '', ownerName, b.email).catch(() => {});
    updateLegacy({ beneficiary: undefined, enabled: false });
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    showToast(t('legacy.beneficiaryRemoved'), tc.orange);
  };

  const handleLegacyToggle = () => {
    if (!legacy.beneficiary) { setShowBeneficiaryModal(true); return; }
    if (legacy.enabled) {
      updateLegacy({ enabled: false });
      showToast(t('legacy.legacyDisabled'), tc.orange);
    } else {
      updateLegacy({ enabled: true, lastActiveAt: Date.now() });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(t('legacy.legacyActivated'));
    }
  };

  /**
   * Seal the vault for legacy transfer.
   *
   * Validates prerequisites (beneficiary + guardians), then calls the three-layer
   * sealVaultForLegacy() from VaultContext.  Phase labels are cycled automatically
   * so the user sees what's happening during the multi-second crypto operation.
   *
   * On success: opens the SealSuccessSheet with a per-layer breakdown.
   * On failure: shows an inline error box with the rejection reason.
   *
   * The owner's vault is NOT locked or modified — they can keep using it normally.
   */
  const handleSealVault = async () => {
    if (!legacy.beneficiary) {
      showToast(t('legacy.setBeneficiaryFirst'), tc.orange);
      return;
    }
    const activeGuardians = guardians.filter(g => g.status === 'active');
    if (activeGuardians.length === 0) {
      showToast(t('legacy.addGuardianFirst'), tc.orange);
      return;
    }

    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    setSealState('loading');
    setSealPhaseIdx(0);
    setSealError('');
    clearPhaseTimers();

    // Cycle through phase labels while the async operation runs
    const phaseCount = 4;
    for (let i = 1; i < phaseCount; i++) {
      const timer = setTimeout(() => setSealPhaseIdx(i), i * 1600);
      phaseTimers.current.push(timer);
    }

    // Safety timeout: if the seal operation takes more than 35s, force an error
    // state so the button never stays disabled indefinitely.
    if (sealTimeoutRef.current) clearTimeout(sealTimeoutRef.current);
    sealTimeoutRef.current = setTimeout(() => {
      clearPhaseTimers();
      setSealState('error');
      setSealError(t('legacy.sealTimeout'));
      showToast(t('legacy.sealTimeoutToast'), tc.red);
    }, 35000);

    try {
      const result = await sealVaultForLegacy();
      // Clear safety timeout — operation completed before the deadline
      if (sealTimeoutRef.current) { clearTimeout(sealTimeoutRef.current); sealTimeoutRef.current = null; }
      clearPhaseTimers();

      if (result.success) {
        const now = Date.now();
        setSealState('done');
        setSealResult(result);
        setSealedAt(now);
        setShowSealSuccess(true);
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setSealState('error');
        setSealError(result.error ?? t('legacy.unknownError'));
        showToast(result.error ?? t('legacy.sealFailed'), tc.red);
      }
    } catch (e: unknown) {
      if (sealTimeoutRef.current) { clearTimeout(sealTimeoutRef.current); sealTimeoutRef.current = null; }
      clearPhaseTimers();
      setSealState('error');
      const msg = (e as Error)?.message ?? t('legacy.unknownError');
      setSealError(msg);
      showToast(msg, tc.red);
    }
  };

  const activeGuardians = guardians.filter(g => g.status === 'active');

  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <View style={[styles.container, { backgroundColor: tc.background }]}>
      <ScreenGlow color="#F97316" icon="clock" />

      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={20} color={tc.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('legacy.title')}</Text>
        <View style={{ width: 38 }} />
      </View>

      {/* ── Toast banner ── */}
      {toast ? (
        <View style={[styles.toastBanner, {
          borderColor: `${toast.color ?? tc.green}40`,
          backgroundColor: `${toast.color ?? tc.green}10`,
        }]}>
          <Feather name="check-circle" size={13} color={toast.color ?? tc.green} />
          <Text style={[styles.toastText, { color: toast.color ?? tc.green }]}>{toast.msg}</Text>
        </View>
      ) : null}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 }]}>

        {/* ── Hero ── */}
        <LinearGradient
          colors={['rgba(139,92,246,0.20)', 'rgba(59,130,246,0.15)']}
          style={styles.heroBanner}
        >
          <HexagonLogo size={70} animated={false} />
          <View style={styles.heroText}>
            <Text style={styles.heroTitle}>{t('legacy.title')}</Text>
            <Text style={styles.heroSubtitle}>{t('legacy.subtitle')}</Text>
          </View>
        </LinearGradient>

        {/* ── Feature pills ── */}
        <View style={styles.featuresRow}>
          <LegacyFeature icon="user-check" title={t('legacy.heirAccess')} subtitle={t('legacy.heirAccessSub')} color={tc.purple} />
          <LegacyFeature icon="lock"       title={t('legacy.secureTransfer')} subtitle={t('legacy.secureTransferSub')} color={tc.blue} />
          <LegacyFeature icon="clock"      title={t('legacy.timeCapsule')} subtitle={t('legacy.timeCapsuleSub')} color={tc.gold} />
        </View>

        {/* ── Beneficiary Card ── */}
        <GlassCard variant="gold" style={styles.card} padding={18}>
          <View style={styles.cardHeader}>
            <View style={[styles.cardIcon, { backgroundColor: tc.goldGlass }]}>
              <Feather name="user" size={18} color={tc.gold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{t('legacy.beneficiary')}</Text>
              <Text style={styles.cardSub}>{t('legacy.beneficiarySub')}</Text>
            </View>
          </View>

          {legacy.beneficiary ? (
            <>
              <View style={styles.beneficiaryInfo}>
                <View style={styles.beneficiaryAvatar}>
                  <Text style={styles.beneficiaryInitials}>
                    {legacy.beneficiary.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.beneficiaryName}>{legacy.beneficiary.name}</Text>
                  <Text style={styles.beneficiaryEmail}>{legacy.beneficiary.email}</Text>
                </View>
                {/* Status badge — mirrors guardian StatusBadge */}
                {(() => {
                  const st = legacy.beneficiary.inviteStatus;
                  if (!st) return null;
                  const col = st === 'accepted' ? tc.green : st === 'rejected' ? tc.red : tc.orange;
                  const label = st === 'accepted' ? t('legacy.statusActive') : st === 'rejected' ? t('legacy.statusRejected') : t('legacy.statusPending');
                  return (
                    <View style={[styles.bStatusBadge, { backgroundColor: `${col}20`, borderColor: `${col}50` }]}>
                      <View style={[styles.bStatusDot, { backgroundColor: col }]} />
                      <Text style={[styles.bStatusText, { color: col }]}>{label}</Text>
                    </View>
                  );
                })()}
              </View>
              <View style={styles.beneficiaryActions}>
                <TouchableOpacity style={styles.editBtn} onPress={() => setShowBeneficiaryModal(true)}>
                  <Feather name="edit-2" size={14} color={tc.gold} />
                  <Text style={styles.editBtnText}>{t('common.edit')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteBeneficiary}>
                  <Feather name="trash-2" size={14} color={tc.red} />
                  <Text style={styles.deleteBtnText}>{t('legacy.deleteBeneficiary')}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <TouchableOpacity style={styles.addBeneficiaryBtn} onPress={() => setShowBeneficiaryModal(true)}>
              <Text style={styles.addBeneficiaryText}>{t('legacy.addBeneficiary')}</Text>
            </TouchableOpacity>
          )}
        </GlassCard>

        {/* ── Absence Timer ── */}
        <GlassCard style={styles.card} padding={18}>
          <View style={styles.cardHeader}>
            <View style={[styles.cardIcon, { backgroundColor: tc.purpleGlass }]}>
              <Feather name="clock" size={18} color={tc.purple} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{t('legacy.deathSwitch')}</Text>
              <Text style={styles.cardSub}>
                {legacy.enabled ? t('legacy.deathSwitchSub') : t('legacy.timerActiveOnly')}
              </Text>
            </View>
            {legacy.enabled && (
              <View style={styles.activeBadge}>
                <View style={styles.activeDot} />
                <Text style={styles.activeBadgeText}>{t('legacy.activeBadge')}</Text>
              </View>
            )}
          </View>
          <View style={styles.daysRow}>
            {ROW1.map(d => (
              <TouchableOpacity
                key={d}
                style={[styles.dayChip, legacy.absenceDays === d && { backgroundColor: tc.purpleGlass, borderColor: tc.purple }]}
                onPress={() => handleDaysSelect(d)}
              >
                <Text style={[styles.dayChipText, legacy.absenceDays === d && { color: tc.purple }]}>
                  {t(`legacy.days${d}` as any)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={[styles.daysRow, { marginTop: 8 }]}>
            {ROW2.map(d => (
              <TouchableOpacity
                key={d}
                style={[styles.dayChip, { flex: 1 }, legacy.absenceDays === d && { backgroundColor: tc.purpleGlass, borderColor: tc.purple }]}
                onPress={() => handleDaysSelect(d)}
              >
                <Text style={[styles.dayChipText, legacy.absenceDays === d && { color: tc.purple }]}>
                  {t(`legacy.days${d}` as any)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </GlassCard>

        {/* ── 48h Protocol ── */}
        <GlassCard style={styles.card} padding={18}>
          <View style={styles.cardHeader}>
            <View style={[styles.cardIcon, { backgroundColor: tc.blueGlass }]}>
              <Feather name="bell" size={18} color={tc.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{t('legacy.protocol48h')}</Text>
              <Text style={styles.cardSub}>{t('legacy.protocol48hSub')}</Text>
            </View>
          </View>
          <View style={styles.protocolSteps}>
            {[
              { label: t('legacy.protocolStep1'), active: true },
              { label: t('legacy.protocolStep2'), active: true },
              { label: t('legacy.protocolStep3'), active: false },
              { label: t('legacy.protocolStep4', { m: legacy.mOfN.m, n: legacy.mOfN.n }), active: false },
            ].map((step, i) => (
              <View key={i} style={styles.protocolStep}>
                <View style={[styles.protocolDot, { backgroundColor: step.active ? tc.blue : tc.textMuted }]} />
                <Text style={[styles.protocolText, !step.active && { color: tc.textMuted }]}>{step.label}</Text>
              </View>
            ))}
          </View>
        </GlassCard>

        {/* ── Guardian Approval ── */}
        <GlassCard variant="purple" style={styles.card} padding={18}>
          <View style={styles.cardHeader}>
            <View style={[styles.cardIcon, { backgroundColor: tc.purpleGlass }]}>
              <Feather name="users" size={18} color={tc.purple} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{t('legacy.guardianApproval')}</Text>
              <Text style={styles.cardSub}>{t('legacy.guardianApprovalSub', { m: legacy.mOfN.m, n: legacy.mOfN.n })}</Text>
            </View>
          </View>
        </GlassCard>

        {/* ────────────────────────────────────────────────────────────────────
            Seal Vault Card
            ──────────────────────────────────────────────────────────────────
            Purpose of "إغلاق الخزنة الآن":
              Creates a sealed cryptographic package from the current vault
              contents and uploads it to the server.  This does NOT end the
              owner's session — they keep their vault unlocked and usable.
              The button can be pressed again at any time to refresh the
              sealed package with the latest vault contents.

            The three-layer breakdown shown below maps directly to the seal
            flow in legacyTransfer.ts / keyManager.ts / shamirUtils.ts.
        ──────────────────────────────────────────────────────────────────── */}
        <GlassCard style={styles.card} padding={18}>
          <View style={styles.cardHeader}>
            <View style={[styles.cardIcon, { backgroundColor: 'rgba(212,175,55,0.15)' }]}>
              <Feather name="lock" size={18} color={tc.gold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{t('legacy.sealVaultTitle')}</Text>
              <Text style={styles.cardSub}>
                {sealState === 'done'
                  ? t('legacy.sealVaultSubDone')
                  : t('legacy.sealVaultSubIdle')}
              </Text>
            </View>
            {sealState === 'done' && (
              <View style={[styles.activeBadge, { borderColor: 'rgba(212,175,55,0.30)', backgroundColor: 'rgba(212,175,55,0.12)' }]}>
                <View style={[styles.activeDot, { backgroundColor: tc.gold }]} />
                <Text style={[styles.activeBadgeText, { color: tc.gold }]}>{t('legacy.sealedBadge')}</Text>
              </View>
            )}
          </View>

          {/* ── Layer description ── */}
          <View style={styles.layersContainer}>
            {/*
             * Layer 1: AES-256 encrypts the vault snapshot with a random
             * transfer key (TK).  This is the core blob stored on the server.
             */}
            <View style={styles.layerRow}>
              <View style={[styles.layerDot, { backgroundColor: tc.blue }]} />
              <Text style={styles.layerText}>
                <Text style={{ color: tc.blue }}>Layer 1 — AES-256</Text>
                {'  '}{t('legacy.layer1Desc')}
              </Text>
            </View>
            <View style={styles.layerRow}>
              <View style={[styles.layerDot, { backgroundColor: tc.purple }]} />
              <Text style={styles.layerText}>
                <Text style={{ color: tc.purple }}>Layer 2 — RSA-OAEP</Text>
                {'  '}{t('legacy.layer2Desc')}
              </Text>
            </View>
            <View style={styles.layerRow}>
              <View style={[styles.layerDot, { backgroundColor: tc.gold }]} />
              <Text style={styles.layerText}>
                <Text style={{ color: tc.gold }}>
                  Layer 3 — Shamir {legacy.mOfN.m}/{activeGuardians.length || legacy.mOfN.n}
                </Text>
                {'  '}{t('legacy.layer3Desc')}
              </Text>
            </View>
          </View>

          {/* ── RSA key status ── */}
          {keyReady && !keyErrorMsg ? (
            <View style={styles.keyStatusRow}>
              <Feather name="key" size={12} color={tc.green} />
              <Text style={[styles.keyStatusText, { color: tc.green }]}>
                {t('legacy.keyReady')}
              </Text>
            </View>
          ) : keyReady && keyErrorMsg ? (
            <View style={styles.rsaGeneratingBox}>
              <Feather name="alert-circle" size={16} color={tc.orange} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rsaGeneratingTitle, { color: tc.orange }]}>
                  {t('legacy.keyReadyServerFail')}
                </Text>
                <Text style={[styles.rsaGeneratingSubtitle, { opacity: 0.8 }]}>
                  {t('legacy.keyReadyServerFailSub')}
                </Text>
              </View>
              <TouchableOpacity onPress={handleRetryKey} style={styles.rsaRetryBtn}>
                <Text style={styles.rsaRetryText}>{t('legacy.retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : keyError && !isRetryingNet ? (
            <View style={styles.rsaGeneratingBox}>
              <Feather name="alert-triangle" size={16} color={tc.orange} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rsaGeneratingTitle, { color: tc.orange }]}>
                  {t('legacy.keyError')}
                </Text>
                {keyErrorMsg ? (
                  <Text style={[styles.rsaGeneratingSubtitle, { color: tc.orange, opacity: 0.8, fontSize: 10, fontFamily: 'monospace' }]}>
                    {keyErrorMsg}
                  </Text>
                ) : (
                  <Text style={styles.rsaGeneratingSubtitle}>
                    {t('legacy.keyErrorRetry')}
                  </Text>
                )}
              </View>
              <TouchableOpacity
                onPress={handleRetryKey}
                style={styles.rsaRetryBtn}
              >
                <Text style={styles.rsaRetryText}>{t('legacy.retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.rsaGeneratingBox}>
              <ActivityIndicator size="small" color={tc.purple} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.rsaGeneratingTitle}>
                    {t('legacy.keyGenerating')}
                  </Text>
                  {keyGenElapsed > 0 && (
                    <Text style={{ color: tc.purple, fontSize: 11, fontFamily: 'Poppins_400Regular', opacity: 0.8 }}>
                      {keyGenElapsed}ث
                    </Text>
                  )}
                </View>
                <Text style={styles.rsaGeneratingSubtitle}>
                  {keyGenElapsed < 5
                    ? t('legacy.keyGeneratingSub')
                    : keyGenElapsed < 30
                    ? 'جارٍ التوليد… قد يستغرق 10–40 ثانية'
                    : 'لا يزال يعمل… يعتمد على قوة المعالج'}
                </Text>
              </View>
            </View>
          )}

          {/* ── Error box ── */}
          {sealState === 'error' && sealError ? (
            <View style={styles.sealErrorBox}>
              <Feather name="alert-circle" size={12} color={tc.red} />
              <Text style={styles.sealErrorText}>{sealError}</Text>
            </View>
          ) : null}

          {/* ── Seal button ──
              Disabled when: RSA key not ready, or seal operation in progress.
              Loading: cycles through SEAL_PHASES labels (1 per 1.6 s).
              Done: turns green — can be pressed again to refresh the package.
          ── */}
          <TouchableOpacity
            style={[styles.sealBtn, (sealState === 'loading' || !keyReady) && { opacity: 0.6 }]}
            activeOpacity={0.85}
            disabled={sealState === 'loading' || !keyReady}
            onPress={handleSealVault}
          >
            <LinearGradient
              colors={sealState === 'done' ? ['#22C55E', '#16A34A'] : ['#D4AF37', '#B8960C']}
              style={styles.sealGrad}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            >
              {sealState === 'loading' ? (
                <ActivityIndicator size="small" color="#0A0F1E" />
              ) : (
                <Feather
                  name={sealState === 'done' ? 'check-circle' : 'lock'}
                  size={16}
                  color="#0A0F1E"
                />
              )}
              <Text style={styles.sealBtnText}>
                {sealState === 'loading'
                  ? t(`legacy.sealPhase${sealPhaseIdx + 1}` as any)
                  : sealState === 'done'
                    ? t('legacy.sealRefresh')
                    : t('legacy.sealNow')}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </GlassCard>

        {/* ── Activate / Deactivate Button ── */}
        <TouchableOpacity style={styles.setLegacyBtn} activeOpacity={0.85} onPress={handleLegacyToggle}>
          <LinearGradient
            colors={legacy.enabled ? ['#22C55E', '#16A34A'] : ['#D4AF37', '#B8960C']}
            style={styles.setLegacyGrad}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          >
            <Feather name={legacy.enabled ? 'check-circle' : 'shield'} size={20} color={legacy.enabled ? '#fff' : '#0A0F1E'} />
            <Text style={[styles.setLegacyText, { color: legacy.enabled ? '#fff' : '#0A0F1E' }]}>
              {legacy.enabled ? t('legacy.legacyActive') : t('legacy.setLegacy')}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Modals ── */}
      <BeneficiaryModal
        visible={showBeneficiaryModal}
        onClose={() => setShowBeneficiaryModal(false)}
        onSave={handleSaveBeneficiary}
      />

      {sealResult && (
        <SealSuccessSheet
          visible={showSealSuccess}
          onClose={() => setShowSealSuccess(false)}
          result={sealResult}
          beneficiaryName={legacy.beneficiary?.name ?? ''}
          guardianCount={activeGuardians.length}
          mOfN={legacy.mOfN}
          itemCount={items.length}
          sealedAt={sealedAt}
        />
      )}

      <LegacyOnboardingModal
        visible={showOnboarding}
        onDismiss={handleOnboardingDismiss}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  container: { flex: 1 },
  toastBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 20, marginBottom: 6,
    paddingVertical: 9, paddingHorizontal: 14,
    borderRadius: 12, borderWidth: 1,
  },
  toastText: { fontSize: 12, fontFamily: 'Poppins_400Regular', flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 12,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: tc.glass, borderWidth: 1,
    borderColor: tc.glassBorder, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold', letterSpacing: 1, lineHeight: 26, includeFontPadding: false },
  scrollContent: { paddingHorizontal: 20 },
  heroBanner: {
    flexDirection: 'row', borderRadius: 20, padding: 20,
    borderWidth: 1, borderColor: 'rgba(139,92,246,0.30)',
    gap: 16, alignItems: 'center', marginBottom: 20,
  },
  heroText: { flex: 1 },
  heroTitle: { fontSize: 18, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold', lineHeight: 26, includeFontPadding: false },
  heroSubtitle: { fontSize: 12, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', marginTop: 4 },
  featuresRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, gap: 8 },
  feature: { flex: 1, alignItems: 'center', gap: 6 },
  featureIcon: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  featureTitle: { fontSize: 11, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center' },
  featureSub: { fontSize: 9, color: tc.textMuted, fontFamily: 'Poppins_400Regular', textAlign: 'center' },
  card: { marginBottom: 14 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  cardIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '600', color: tc.text, fontFamily: 'Poppins_600SemiBold' },
  cardSub: { fontSize: 11, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', marginTop: 2 },
  activeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(34,197,94,0.12)', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(34,197,94,0.30)',
  },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: tc.green },
  activeBadgeText: { fontSize: 10, color: tc.green, fontFamily: 'Poppins_600SemiBold' },
  beneficiaryInfo: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  beneficiaryAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: tc.goldGlass, borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.40)', alignItems: 'center', justifyContent: 'center',
  },
  beneficiaryInitials: { fontSize: 16, fontWeight: '700', color: tc.gold, fontFamily: 'Poppins_700Bold' },
  beneficiaryName: { fontSize: 14, fontWeight: '600', color: tc.text, fontFamily: 'Poppins_600SemiBold' },
  beneficiaryEmail: { fontSize: 12, color: tc.textSecondary, fontFamily: 'Poppins_400Regular' },
  bStatusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  bStatusDot: { width: 5, height: 5, borderRadius: 3 },
  bStatusText: { fontSize: 10, fontFamily: 'Poppins_400Regular' },
  beneficiaryActions: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  editBtnText: { fontSize: 12, color: tc.gold, fontFamily: 'Poppins_400Regular' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  deleteBtnText: { fontSize: 12, color: tc.red, fontFamily: 'Poppins_400Regular' },
  addBeneficiaryBtn: {
    backgroundColor: tc.goldGlass, borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.30)', borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center',
  },
  addBeneficiaryText: { fontSize: 13, color: tc.gold, fontFamily: 'Poppins_600SemiBold' },
  daysRow: { flexDirection: 'row', gap: 8 },
  dayChip: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderRadius: 12, borderWidth: 1,
    borderColor: tc.glassBorder, backgroundColor: tc.glass,
  },
  dayChipText: { fontSize: 12, color: tc.textSecondary, fontFamily: 'Poppins_600SemiBold' },
  protocolSteps: { gap: 10 },
  protocolStep: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  protocolDot: { width: 8, height: 8, borderRadius: 4 },
  protocolText: { fontSize: 12, color: tc.text, fontFamily: 'Poppins_400Regular', flex: 1 },
  setLegacyBtn: {
    borderRadius: 50, overflow: 'hidden', marginTop: 6, marginBottom: 20,
    shadowColor: tc.gold, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  setLegacyGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 18 },
  setLegacyText: { fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold' },

  // ── Modal shared styles ──
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#0D1428', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 40, borderTopWidth: 1, borderColor: 'rgba(212,175,55,0.20)',
  },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: tc.glass, alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold', marginBottom: 4 },
  modalSub: { fontSize: 12, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', marginBottom: 16 },
  modalInput: {
    backgroundColor: tc.glass, borderWidth: 1, borderColor: tc.glassBorder,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    color: tc.text, fontFamily: 'Poppins_400Regular', fontSize: 14, marginBottom: 10,
  },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  modalCancel: {
    flex: 1, paddingVertical: 14, alignItems: 'center',
    backgroundColor: tc.glass, borderRadius: 14, borderWidth: 1, borderColor: tc.glassBorder,
  },
  modalCancelText: { color: tc.textSecondary, fontFamily: 'Poppins_600SemiBold', fontSize: 14 },
  modalConfirm: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  modalConfirmGrad: { paddingVertical: 14, alignItems: 'center' },
  modalConfirmText: { color: '#0A0F1E', fontWeight: '700', fontFamily: 'Poppins_700Bold', fontSize: 14 },

  // ── Seal card internals ──
  layersContainer: { gap: 8, marginBottom: 14 },
  layerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  layerDot: { width: 8, height: 8, borderRadius: 4 },
  layerText: { fontSize: 11, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', flex: 1 },

  keyStatusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 12, paddingVertical: 6, paddingHorizontal: 10,
    backgroundColor: 'rgba(34,197,94,0.06)',
    borderRadius: 8, borderWidth: 1, borderColor: 'rgba(34,197,94,0.18)',
  },
  keyStatusText: { fontSize: 11, fontFamily: 'Poppins_400Regular' },

  rsaGeneratingBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    marginBottom: 12, paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: 'rgba(139,92,246,0.08)',
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(139,92,246,0.20)',
  },
  rsaGeneratingTitle: {
    fontSize: 11, fontFamily: 'Poppins_600SemiBold',
    color: tc.purple, marginBottom: 2,
  },
  rsaGeneratingSubtitle: {
    fontSize: 10, fontFamily: 'Poppins_400Regular',
    color: tc.textMuted, lineHeight: 14,
  },
  rsaRetryBtn: {
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: 'rgba(249,115,22,0.15)',
    borderRadius: 8, borderWidth: 1,
    borderColor: 'rgba(249,115,22,0.30)',
  },
  rsaRetryText: {
    fontSize: 11, color: tc.orange,
    fontFamily: 'Poppins_600SemiBold',
  },

  sealErrorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.20)',
    paddingHorizontal: 10, paddingVertical: 7, marginBottom: 10,
  },
  sealErrorText: { fontSize: 11, color: tc.red, fontFamily: 'Poppins_400Regular', flex: 1 },

  sealBtn: { borderRadius: 14, overflow: 'hidden', marginTop: 4 },
  sealGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  sealBtnText: { fontSize: 13, fontWeight: '700', fontFamily: 'Poppins_700Bold', color: '#0A0F1E', flex: 1, textAlign: 'center' },
});

// ── Success sheet styles ──────────────────────────────────────────────────────

const successStyles = StyleSheet.create({
  iconWrap: { alignItems: 'center', marginBottom: 14 },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.30)',
  },
  title: {
    fontSize: 20, fontWeight: '700', color: colors.dark.text,
    fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 4,
  },
  timestamp: {
    fontSize: 11, color: colors.dark.textMuted,
    fontFamily: 'Poppins_400Regular', textAlign: 'center', marginBottom: 6,
  },
  subtitle: {
    fontSize: 12, color: colors.dark.textSecondary,
    fontFamily: 'Poppins_400Regular', textAlign: 'center', marginBottom: 20,
    lineHeight: 18,
  },
  layersBox: {
    gap: 10, marginBottom: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    padding: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 12, fontFamily: 'Poppins_600SemiBold' },
  rowSublabel: { fontSize: 10, fontFamily: 'Poppins_400Regular', marginTop: 1 },
  warnBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(249,115,22,0.08)', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(249,115,22,0.25)',
    padding: 12, marginBottom: 16,
  },
  warnText: {
    fontSize: 11, color: colors.dark.orange,
    fontFamily: 'Poppins_400Regular', flex: 1, lineHeight: 16,
  },
});

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import * as Haptics from 'expo-haptics';
import { GlassCard } from '@/components/GlassCard';
import { useVault, Guardian, AuditEntry } from '@/contexts/VaultContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme, ThemeColors } from '@/contexts/ThemeContext';
import { ScreenGlow } from '@/components/shared/ScreenGlow';
import { inviteGuardian, notifyGuardianRemoved, checkInviteStatus } from '@/utils/emailApi';
import { sendGuardianNotification } from '@/utils/fcmService';
import { useNetworkRequired } from '@/contexts/NetworkContext';

/* ─── Helpers ─── */
type TFunc = (key: string, params?: Record<string, string | number>) => string;

function timeAgo(ts: number, t: TFunc): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('guardians.timeJustNow');
  if (mins < 60) return t('guardians.timeMinutesAgo', { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('guardians.timeHoursAgo', { n: hrs });
  return t('guardians.timeDaysAgo', { n: Math.floor(hrs / 24) });
}

/* ─── Avatar ─── */
// React.memo: avatar only changes when name or color prop changes
const GuardianAvatar = React.memo(function GuardianAvatar({ name, color }: { name: string; color: string }) {
  const initials = name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <View style={[styles.avatar, { backgroundColor: `${color}25`, borderColor: `${color}60` }]}>
      <Text style={[styles.avatarText, { color }]}>{initials}</Text>
    </View>
  );
});

/* ─── Status badge ─── */
// React.memo: badge only changes when status prop changes
const StatusBadge = React.memo(function StatusBadge({ status }: { status: Guardian['status'] }) {
  const { t } = useLanguage();
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const colorMap: Record<string, string> = {
    active: tc.green,
    pending: tc.orange,
    inactive: tc.textMuted,
    rejected: tc.red,
  };
  const col = colorMap[status] ?? tc.textMuted;
  const label = status === 'rejected' ? t('guardians.rejected') : t(`guardians.${status}`);
  return (
    <View style={[styles.statusBadge, { backgroundColor: `${col}20`, borderColor: `${col}50` }]}>
      <View style={[styles.statusDot, { backgroundColor: col }]} />
      <Text style={[styles.statusText, { color: col }]}>{label}</Text>
    </View>
  );
});

/* ─── Toast ─── */
// React.memo: toast only re-renders when message or color changes
const Toast = React.memo(function Toast({ message, color = '#22C55E' }: { message: string; color?: string }) {
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <View style={[styles.toast, { backgroundColor: `${color}18`, borderColor: `${color}40` }]}>
      <Feather name={color === tc.red ? 'alert-circle' : 'mail'} size={13} color={color} />
      <Text style={[styles.toastText, { color }]}>{message}</Text>
    </View>
  );
});

/* ─── Activity Modal ─── */
function ActivityModal({
  visible, onClose, guardians, auditLog,
}: {
  visible: boolean;
  onClose: () => void;
  guardians: Guardian[];
  auditLog: AuditEntry[];
}) {
  const { t } = useLanguage();
  const recentLog = [...auditLog].reverse().slice(0, 25);

  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const actStyles = useMemo(() => makeActStyles(tc), [tc]);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { maxHeight: '90%', flex: 1 }]}>
          <View style={styles.modalHandle} />
          <View style={actStyles.header}>
            <View style={actStyles.headerLeft}>
              <View style={actStyles.headerIcon}>
                <Feather name="activity" size={18} color={tc.purple} />
              </View>
              <Text style={styles.modalTitle}>{t('guardians.activityTitle')}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={20} color={tc.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {/* Guardians section */}
            <Text style={actStyles.sectionLabel}>{t('guardians.guardiansSection')}</Text>
            {guardians.length === 0 && (
              <Text style={actStyles.empty}>{t('guardians.noGuardians')}</Text>
            )}
            {guardians.map(g => (
              <View key={g.id} style={actStyles.row}>
                <View style={[actStyles.statusDot, {
                  backgroundColor: g.status === 'active' ? tc.green
                    : g.status === 'pending' ? tc.orange
                    : tc.red,
                }]} />
                <View style={{ flex: 1 }}>
                  <Text style={actStyles.name}>{g.name}</Text>
                  <Text style={actStyles.sub}>{g.relationship} · {g.email}</Text>
                </View>
                <View style={[actStyles.sourceChip, {
                  borderColor: g.inviteToken ? `${tc.gold}40` : `${tc.purple}40`,
                  backgroundColor: g.inviteToken ? `${tc.gold}12` : `${tc.purple}12`,
                }]}>
                  <Feather
                    name={g.inviteToken ? 'link' : 'shield'}
                    size={11}
                    color={g.inviteToken ? tc.gold : tc.purple}
                  />
                  <Text style={[actStyles.sourceText, {
                    color: g.inviteToken ? tc.gold : tc.purple,
                  }]}>
                    {g.inviteToken ? t('guardians.viaLink') : t('guardians.viaApp')}
                  </Text>
                </View>
                <StatusBadge status={g.status} />
              </View>
            ))}

            {/* Audit log section */}
            <Text style={[actStyles.sectionLabel, { marginTop: 22 }]}>{t('guardians.recentActivity')}</Text>
            {recentLog.length === 0 && (
              <Text style={actStyles.empty}>{t('guardians.noActivity')}</Text>
            )}
            {recentLog.map(e => (
              <View key={e.id} style={actStyles.logRow}>
                <View style={[actStyles.logIcon, {
                  backgroundColor: e.source === 'link' ? `${tc.gold}20` : `${tc.purple}20`,
                }]}>
                  <Feather
                    name={e.source === 'link' ? 'link' : 'shield'}
                    size={12}
                    color={e.source === 'link' ? tc.gold : tc.purple}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={actStyles.logAction}>{e.action}</Text>
                  <Text style={actStyles.logTime}>{timeAgo(e.timestamp, t)}</Text>
                </View>
              </View>
            ))}
            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ─── Add Guardian Modal ─── */
function AddGuardianModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const { addGuardian, updateGuardian, legacy, guardians } = useVault();
  const requireNetwork = useNetworkRequired();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (closingTimerRef.current) clearTimeout(closingTimerRef.current);
  }, []);

  const showToast = (msg: string, color = tc.green) => {
    setToast({ msg, color });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  };

  const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

  const handleAdd = async () => {
    if (!name.trim() || !email.trim()) return;
    if (!isValidEmail(email.trim())) {
      showToast(t('guardians.invalidEmail'), tc.orange);
      return;
    }
    // Secondary guard — prevents bypass via direct modal manipulation
    if (guardians.length >= 3) {
      showToast(t('guardians.maxGuardians', { max: 3 }), tc.orange);
      return;
    }
    setSending(true);

    try {
      await requireNetwork();
    } catch {
      showToast(t('guardians.noInternet'), tc.orange);
      setSending(false);
      return;
    }

    try {
      const newG = addGuardian({
        name: name.trim(),
        email: email.trim(),
        relationship: relationship.trim() || 'Guardian',
        status: 'pending',
      });

      const ownerName = legacy.ownerName || 'Vault Owner';
      const result = await inviteGuardian(legacy.ownerEmail || '', ownerName, name.trim(), email.trim());

      if (result.success && result.token) {
        updateGuardian(newG.id, { inviteToken: result.token });
      }

      // ── FCM: fire-and-forget — never block the modal on push delivery ────
      sendGuardianNotification('added', name.trim()).then(r => {
        if (!r.success) console.warn('[auryx][FCM] guardian push failed:', r.error);
      }).catch(() => {});

      setSending(false);
      if (result.success) {
        showToast(t('guardians.inviteSent', { email: email.trim() }));
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        showToast(t('guardians.emailFailed'), tc.orange);
      }

      closingTimerRef.current = setTimeout(() => {
        setName(''); setEmail(''); setRelationship('');
        onClose();
      }, 1500);
    } catch (err) {
      setSending(false);
      showToast(t('guardians.genericError'), tc.red ?? tc.orange);
      console.warn('[auryx][guardian] handleAdd error:', err);
    }
  };

  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>{t('guardians.addGuardian')}</Text>
          <TextInput
            style={styles.modalInput}
            placeholder={t('guardians.name')}
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
            placeholder={t('guardians.email')}
            placeholderTextColor={tc.textMuted}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="next"
          />
          <TextInput
            style={styles.modalInput}
            placeholder={t('guardians.relationship')}
            placeholderTextColor={tc.textMuted}
            value={relationship}
            onChangeText={setRelationship}
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="done"
          />
          {toast && <Toast message={toast.msg} color={toast.color} />}
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalConfirm} onPress={handleAdd} disabled={sending}>
              <LinearGradient colors={['#8B5CF6', '#6D28D9']} style={styles.modalConfirmGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Text style={styles.modalConfirmText}>
                  {sending ? t('guardians.sending') : t('guardians.invite')}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ─── Confirm Remove Modal ─── */
function RemoveGuardianModal({
  visible, guardian, ownerName, onConfirm, onCancel,
}: {
  visible: boolean;
  guardian: Guardian | null;
  ownerName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  if (!guardian) return null;
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { paddingBottom: 28 }]}>
          <View style={styles.modalHandle} />
          <View style={styles.removeIcon}>
            <Feather name="user-minus" size={24} color={tc.red} />
          </View>
          <Text style={styles.modalTitle}>{t('guardians.removeTitle')}</Text>
          <Text style={styles.removeMsg}>
            {t('guardians.removeMsg', { name: guardian.name })}
          </Text>
          <View style={[styles.modalActions, { marginTop: 20 }]}>
            <TouchableOpacity style={styles.modalCancel} onPress={onCancel}>
              <Text style={styles.modalCancelText}>{t('common.no')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalConfirm, { backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(239,68,68,0.30)' }]}
              onPress={onConfirm}
            >
              <Text style={[styles.modalConfirmText, { color: tc.red }]}>{t('common.yes')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ─── Main Screen ─── */
export default function GuardiansScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { guardians, removeGuardian, legacy, updateGuardian, auditLog } = useVault();
  const [showAdd, setShowAdd] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [guardianToRemove, setGuardianToRemove] = useState<Guardian | null>(null);
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);
  const tabBarHeight = 60 + (Platform.OS === 'web' ? 34 : insets.bottom);
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  const MAX_GUARDIANS = 3;
  const atLimit = guardians.length >= MAX_GUARDIANS;

  const handleOpenAdd = () => {
    if (atLimit) {
      showToast(
        t('guardians.maxGuardiansUpgrade', { max: MAX_GUARDIANS }),
        tc.orange,
      );
      return;
    }
    setShowAdd(true);
  };

  const activeCount = guardians.filter(g => g.status === 'active').length;
  const threshold = { m: 2, n: guardians.length || 1 };

  // Keep a ref so the polling interval can read the latest guardians without re-running
  const guardianRef = useRef(guardians);
  useEffect(() => { guardianRef.current = guardians; }, [guardians]);

  // Poll pending invite statuses every 60 seconds
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const pending = guardianRef.current.filter(g => g.status === 'pending' && g.inviteToken);
      for (const g of pending) {
        if (cancelled || !g.inviteToken) continue;
        const { status } = await checkInviteStatus(g.inviteToken);
        if (cancelled) return;
        if (status === 'accepted') {
          updateGuardian(g.id, { status: 'active' });
        } else if (status === 'rejected') {
          updateGuardian(g.id, { status: 'rejected' });
        }
      }
    };
    poll();
    const interval = setInterval(poll, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const showToast = (msg: string, color = tc.green) => {
    setToast({ msg, color });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  };

  const handleConfirmRemove = async () => {
    if (!guardianToRemove) return;
    const g = guardianToRemove;
    setGuardianToRemove(null);

    try {
      removeGuardian(g.id);

      const ownerName = legacy.ownerName || 'Vault Owner';
      const [emailResult, fcmResult] = await Promise.all([
        notifyGuardianRemoved(legacy.ownerEmail || '', ownerName, g.email),
        sendGuardianNotification('removed', g.name),
      ]);

      // ── FCM log ───────────────────────────────────────────────────────────
      if (fcmResult.success) {
        console.log('[auryx][FCM] تم إرسال إشعار بنجاح — guardian removed:', g.name);
      } else {
        console.warn('[auryx][FCM] فشل إرسال الإشعار – تحقق من إعدادات Firebase:', fcmResult.error);
      }

      if (emailResult.success) {
        showToast(t('guardians.removedNotified', { name: g.name }));
      } else {
        showToast(t('guardians.removedLocal', { name: g.name }), tc.orange);
      }

      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err) {
      showToast(t('guardians.genericError'), tc.red ?? tc.orange);
      console.warn('[auryx][guardian] handleConfirmRemove error:', err);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: tc.background }]}>
      <ScreenGlow color="#22C55E" icon="shield" />
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
        <View style={styles.headerLeft}>
          <Feather name="menu" size={20} color={tc.textSecondary} style={{ marginRight: 8 }} />
          <Text style={styles.headerTitle}>{t('guardians.title')}</Text>
        </View>
        <TouchableOpacity
          style={[
            styles.headerBtn,
            atLimit
              ? { backgroundColor: 'rgba(107,114,128,0.15)', borderColor: 'rgba(107,114,128,0.25)' }
              : { backgroundColor: tc.purpleGlass, borderColor: 'rgba(139,92,246,0.30)' },
          ]}
          onPress={handleOpenAdd}
          activeOpacity={0.75}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather
            name={atLimit ? 'lock' : 'user-plus'}
            size={18}
            color={atLimit ? tc.textMuted : tc.purple}
          />
        </TouchableOpacity>
      </View>

      {/* Global toast */}
      {toast && (
        <View style={{ paddingHorizontal: 20, paddingBottom: 4 }}>
          <Toast message={toast.msg} color={toast.color} />
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + 20 }]}
      >
        {/* Hero Banner */}
        <GlassCard variant="purple" style={styles.heroBanner} padding={20}>
          <View style={styles.heroIconWrap}>
            <Feather name="users" size={40} color={tc.purple} />
          </View>
          <Text style={styles.heroTitle}>{t('guardians.subtitle')}</Text>
          <View style={styles.thresholdBadge}>
            <Feather name="key" size={12} color={tc.gold} />
            <Text style={styles.thresholdText}>{t('guardians.mOfN', { m: threshold.m, n: threshold.n })}</Text>
          </View>
        </GlassCard>

        {/* Guardians List */}
        {guardians.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="user-x" size={48} color={tc.textMuted} />
            <Text style={styles.emptyText}>{t('guardians.noGuardians')}</Text>
            <Text style={styles.emptySubtext}>{t('guardians.addFirstGuardian')}</Text>
            <TouchableOpacity style={styles.emptyAddBtn} onPress={handleOpenAdd}>
              <LinearGradient colors={['#8B5CF6', '#6D28D9']} style={styles.emptyAddBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Feather name="user-plus" size={16} color="#fff" />
                <Text style={styles.emptyAddBtnText}>{t('guardians.addGuardian')}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.guardiansList}>
            {guardians.map(g => (
              <GlassCard key={g.id} style={styles.guardianCard} padding={14}>
                <View style={styles.guardianRow}>
                  <GuardianAvatar name={g.name} color={g.avatarColor} />
                  <View style={styles.guardianInfo}>
                    <Text style={styles.guardianName}>{g.name}</Text>
                    <Text style={styles.guardianRelation}>{g.relationship}</Text>
                    {g.email ? <Text style={styles.guardianEmail}>{g.email}</Text> : null}
                  </View>
                  <StatusBadge status={g.status} />
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => setGuardianToRemove(g)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Feather name="user-minus" size={15} color={tc.red} />
                  </TouchableOpacity>
                </View>
              </GlassCard>
            ))}
          </View>
        )}

        {/* Activity Section */}
        {guardians.length > 0 && (
          <TouchableOpacity onPress={() => setShowActivity(true)} activeOpacity={0.8}>
            <GlassCard style={styles.activityCard} padding={16}>
              <View style={styles.activityRow}>
                <View style={[styles.activityIcon, { backgroundColor: tc.purpleGlass }]}>
                  <Feather name="activity" size={18} color={tc.purple} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityTitle}>{t('guardians.activity')}</Text>
                  <Text style={styles.activitySub}>{t('guardians.viewRecentActions')}</Text>
                </View>
                <View style={styles.activityBadge}>
                  <Text style={styles.activityBadgeText}>{guardians.length}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={tc.textMuted} />
              </View>
            </GlassCard>
          </TouchableOpacity>
        )}
      </ScrollView>

      <AddGuardianModal visible={showAdd} onClose={() => setShowAdd(false)} />

      <RemoveGuardianModal
        visible={guardianToRemove !== null}
        guardian={guardianToRemove}
        ownerName={legacy.ownerName || 'Vault Owner'}
        onConfirm={handleConfirmRemove}
        onCancel={() => setGuardianToRemove(null)}
      />

      <ActivityModal
        visible={showActivity}
        onClose={() => setShowActivity(false)}
        guardians={guardians}
        auditLog={auditLog}
      />
    </View>
  );
}

/* ─── Styles ─── */
const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontSize: 22, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold', letterSpacing: 2 },
  headerBtn: {
    width: 36, height: 36, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8 },
  heroBanner: { alignItems: 'center', marginBottom: 20 },
  heroIconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: tc.purpleGlass,
    borderWidth: 1, borderColor: 'rgba(139,92,246,0.30)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  heroTitle: { fontSize: 14, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', textAlign: 'center', marginBottom: 12 },
  thresholdBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: tc.goldGlass, borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.30)', borderRadius: 20,
    paddingVertical: 6, paddingHorizontal: 14,
  },
  thresholdText: { fontSize: 12, color: tc.gold, fontFamily: 'Poppins_600SemiBold' },
  emptyState: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  emptyText: { fontSize: 18, color: tc.textSecondary, fontFamily: 'Poppins_600SemiBold' },
  emptySubtext: { fontSize: 13, color: tc.textMuted, fontFamily: 'Poppins_400Regular' },
  emptyAddBtn: { marginTop: 12, borderRadius: 20, overflow: 'hidden' },
  emptyAddBtnGrad: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 24 },
  emptyAddBtnText: { color: '#fff', fontFamily: 'Poppins_600SemiBold', fontSize: 14 },
  guardiansList: { gap: 10 },
  guardianCard: {},
  guardianRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5,
  },
  avatarText: { fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold' },
  guardianInfo: { flex: 1 },
  guardianName: { fontSize: 14, fontWeight: '600', color: tc.text, fontFamily: 'Poppins_600SemiBold' },
  guardianRelation: { fontSize: 12, color: tc.textSecondary, fontFamily: 'Poppins_400Regular' },
  guardianEmail: { fontSize: 10, color: tc.textMuted, fontFamily: 'Poppins_400Regular' },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 4, paddingHorizontal: 8,
    borderRadius: 12, borderWidth: 1,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontFamily: 'Poppins_600SemiBold' },
  deleteBtn: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.22)',
  },
  activityCard: { marginTop: 16 },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  activityIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  activityTitle: { fontSize: 14, fontWeight: '600', color: tc.text, fontFamily: 'Poppins_600SemiBold' },
  activitySub: { fontSize: 11, color: tc.textSecondary, fontFamily: 'Poppins_400Regular' },
  activityBadge: {
    backgroundColor: tc.purpleGlass, borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(139,92,246,0.30)',
  },
  activityBadgeText: { fontSize: 11, color: tc.purple, fontFamily: 'Poppins_600SemiBold' },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 9, paddingHorizontal: 14,
    borderRadius: 12, borderWidth: 1, marginBottom: 8,
  },
  toastText: { fontSize: 12, fontFamily: 'Poppins_400Regular', flex: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#0D1428',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 40,
    borderTopWidth: 1, borderColor: 'rgba(139,92,246,0.20)',
  },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: tc.glass, alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold', marginBottom: 12, textAlign: 'center' },
  removeIcon: { alignSelf: 'center', marginBottom: 12, padding: 16, backgroundColor: 'rgba(239,68,68,0.10)', borderRadius: 40 },
  removeMsg: { fontSize: 14, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22, marginBottom: 4 },
  modalInput: {
    backgroundColor: tc.glass, borderWidth: 1,
    borderColor: tc.glassBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    color: tc.text, fontFamily: 'Poppins_400Regular', fontSize: 14, marginBottom: 10,
  },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  modalCancel: {
    flex: 1, paddingVertical: 14, alignItems: 'center',
    backgroundColor: tc.glass, borderRadius: 14,
    borderWidth: 1, borderColor: tc.glassBorder,
  },
  modalCancelText: { color: tc.textSecondary, fontFamily: 'Poppins_600SemiBold', fontSize: 14 },
  modalConfirm: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  modalConfirmGrad: { paddingVertical: 14, alignItems: 'center' },
  modalConfirmText: { color: '#fff', fontWeight: '700', fontFamily: 'Poppins_700Bold', fontSize: 14 },
});

const makeActStyles = (tc: ThemeColors) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 20,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: tc.purpleGlass,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionLabel: {
    fontSize: 10, letterSpacing: 1.5, fontFamily: 'Poppins_600SemiBold',
    color: tc.textMuted, marginBottom: 10, textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1,
    borderBottomColor: 'rgba(139,92,246,0.08)',
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  name: { fontSize: 13, color: tc.text, fontFamily: 'Poppins_600SemiBold' },
  sub: { fontSize: 11, color: tc.textMuted, fontFamily: 'Poppins_400Regular' },
  sourceChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 10, borderWidth: 1,
  },
  sourceText: { fontSize: 10, fontFamily: 'Poppins_600SemiBold' },
  logRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingVertical: 8,
  },
  logIcon: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  logAction: { fontSize: 12, color: tc.text, fontFamily: 'Poppins_400Regular', lineHeight: 18 },
  logTime: { fontSize: 10, color: tc.textMuted, fontFamily: 'Poppins_400Regular' },
  empty: { fontSize: 13, color: tc.textMuted, fontFamily: 'Poppins_400Regular', textAlign: 'center', paddingVertical: 12 },
});

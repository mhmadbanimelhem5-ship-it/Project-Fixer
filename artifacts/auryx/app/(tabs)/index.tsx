import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { NeonCircle } from '@/components/NeonCircle';
import { GlassCard } from '@/components/GlassCard';
import { HexagonLogo } from '@/components/HexagonLogo';
import { NotificationPanel } from '@/components/NotificationPanel';
import { useAuth } from '@/contexts/AuthContext';
import { useVault } from '@/contexts/VaultContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme, ThemeColors } from '@/contexts/ThemeContext';
import { ScreenGlow } from '@/components/shared/ScreenGlow';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: string;
  color: string;
  bgColor: string;
}

const StatCard = React.memo(function StatCard({ label, value, icon, color, bgColor }: StatCardProps) {
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <GlassCard style={styles.statCard} padding={14}>
      <View style={[styles.statIconWrap, { backgroundColor: bgColor }]}>
        <Feather name={icon as any} size={16} color={color} />
      </View>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </GlassCard>
  );
});

interface AbsenceUnitProps { value: number; unit: string; }
const AbsenceUnit = React.memo(function AbsenceUnit({ value, unit }: AbsenceUnitProps) {
  const { colors: tc } = useTheme();
  const { width: sw } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  // Scale number size responsively: 26 on ≥390 px screens, minimum 18 on tiny screens
  const numFontSize = Math.round(Math.min(26, Math.max(18, sw * 0.066)));
  const numLineHeight = Math.round(numFontSize * 1.35);
  const cellMinWidth = Math.round(numFontSize * 1.7);
  return (
    <View style={[styles.absenceUnit, { minWidth: cellMinWidth }]}>
      <Text
        style={[styles.absenceUnitValue, { fontSize: numFontSize, lineHeight: numLineHeight }]}
        allowFontScaling={false}
        numberOfLines={1}
      >
        {String(value).padStart(2, '0')}
      </Text>
      <Text
        style={styles.absenceUnitLabel}
        allowFontScaling={false}
        numberOfLines={1}
      >
        {unit}
      </Text>
    </View>
  );
});

interface QuickActionProps {
  icon: string;
  label: string;
  color: string;
  onPress: () => void;
}

const QuickAction = React.memo(function QuickAction({ icon, label, color, onPress }: QuickActionProps) {
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <Pressable
      style={styles.quickAction}
      onPress={onPress}
      android_ripple={{ color: `${color}30`, borderless: true, radius: 36 }}
    >
      {({ pressed }) => (
        <>
          <View style={[
            styles.quickActionIcon,
            {
              backgroundColor: pressed ? `${color}35` : `${color}18`,
              borderColor: pressed ? `${color}80` : `${color}40`,
              transform: [{ scale: pressed ? 0.92 : 1 }],
            },
          ]}>
            <Feather name={icon as any} size={20} color={pressed ? color : `${color}CC`} />
          </View>
          <Text style={[styles.quickActionLabel, pressed && { color: tc.text }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
});

// ── AbsenceCountdownClock ─────────────────────────────────────────────────────
// Isolated component with its own 1-second interval so the parent OverviewScreen
// (691 lines, many children) is NOT re-rendered every second. Only this small
// component updates on each tick.
const AbsenceCountdownClock = React.memo(function AbsenceCountdownClock({
  lastActiveAt,
  absenceDays,
  timerResetFlash,
}: {
  lastActiveAt: number;
  absenceDays: number;
  timerResetFlash: boolean;
}) {
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const absenceMs = absenceDays * 24 * 60 * 60 * 1000;
  const remaining = Math.max(0, absenceMs - (now - lastActiveAt));
  const cdDays  = Math.floor(remaining / (24 * 60 * 60 * 1000));
  const cdHours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const cdMins  = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  const cdSecs  = Math.floor((remaining % (60 * 1000)) / 1000);
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.absenceTitleRow}>
        <View style={styles.absenceLiveDot} />
        <Text style={styles.absenceTitle}>مؤقت الغياب</Text>
        <View style={styles.absenceDaysBadge}>
          <Text style={styles.absenceDaysBadgeText}>{absenceDays} يوم</Text>
        </View>
      </View>
      <View style={styles.absenceCountdownRow}>
        <AbsenceUnit value={cdDays}  unit="يوم" />
        <Text style={styles.absenceSep} allowFontScaling={false} numberOfLines={1}>:</Text>
        <AbsenceUnit value={cdHours} unit="سا" />
        <Text style={styles.absenceSep} allowFontScaling={false} numberOfLines={1}>:</Text>
        <AbsenceUnit value={cdMins}  unit="دق" />
        <Text style={styles.absenceSep} allowFontScaling={false} numberOfLines={1}>:</Text>
        <AbsenceUnit value={cdSecs}  unit="ثا" />
      </View>
      {timerResetFlash && (
        <View style={styles.timerResetBadge}>
          <Feather name="refresh-cw" size={9} color={tc.green} />
          <Text style={styles.timerResetText}>تمت إعادة ضبط العداد</Text>
        </View>
      )}
    </View>
  );
});

export default function OverviewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useLanguage();
  const { lock } = useAuth();
  const { items, guardians, getWeakItemsCount, legacy, updateLegacy } = useVault();
  const { unreadCount } = useNotifications();
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, []);

  const weakItems = useMemo(() => getWeakItemsCount(), [getWeakItemsCount, items]);
  const securityScore = useMemo(
    () => Math.max(0, 100 - weakItems * 7 - (guardians.length < 2 ? 15 : 0)),
    [weakItems, guardians.length],
  );
  const tabBarHeight = useMemo(
    () => 60 + (Platform.OS === 'web' ? 34 : insets.bottom),
    [insets.bottom],
  );
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    return hour < 12
      ? t('overview.goodMorning')
      : hour < 17
        ? t('overview.goodAfternoon')
        : t('overview.goodEvening');
  }, [t]);

  // ── Absence timer: refs to avoid stale closures in AppState listener ──────
  const legacyRef        = useRef(legacy);
  const updateLegacyRef  = useRef(updateLegacy);
  useEffect(() => { legacyRef.current = legacy; }, [legacy]);
  useEffect(() => { updateLegacyRef.current = updateLegacy; }, [updateLegacy]);

  // Small flash shown for 3 s whenever the dead-man timer is reset on foreground
  const [timerResetFlash, setTimerResetFlash] = useState(false);
  const timerResetFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Dead-man's switch: reset absence timer on every foreground event ─────────
  //
  // The PRIMARY reset happens inside VaultContext.loadVault(), which runs on
  // every cold start / unlock.  lock.tsx navigates to /(tabs) before loadVault
  // resolves, so any mount-time reset here would fire against the DEFAULT legacy
  // (enabled=false) and do nothing.  We therefore skip the mount call and only
  // listen for AppState 'active' events — those always fire while the vault is
  // already loaded and the legacy values in the refs are accurate.
  useEffect(() => {
    const doForegroundReset = () => {
      const l = legacyRef.current;
      if (l.enabled && l.beneficiary) {
        updateLegacyRef.current({ lastActiveAt: Date.now() });
        setTimerResetFlash(true);
        if (timerResetFlashRef.current) clearTimeout(timerResetFlashRef.current);
        timerResetFlashRef.current = setTimeout(() => setTimerResetFlash(false), 3000);
      }
    };
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') doForegroundReset();
    });
    return () => {
      sub.remove();
      if (timerResetFlashRef.current) clearTimeout(timerResetFlashRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derived values — snapshot at render time (accurate to the day for the circle;
  // the per-second clock lives in <AbsenceCountdownClock> so this component
  // does NOT re-render every second).
  const isLegacyActive = legacy.enabled && !!legacy.beneficiary;
  const absenceMs      = legacy.absenceDays * 24 * 60 * 60 * 1000;
  const _nowSnapshot   = Date.now();
  const remaining      = isLegacyActive
    ? Math.max(0, absenceMs - (_nowSnapshot - (legacy.lastActiveAt ?? _nowSnapshot)))
    : 0;
  const pctRemaining = isLegacyActive ? Math.min(100, Math.round((remaining / absenceMs) * 100)) : 100;
  const cdDays       = Math.floor(remaining / (24 * 60 * 60 * 1000));

  const handleOpenNotifications = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    setNotifPanelOpen(true);
  }, []);

  const handleEmergency = useCallback(() => {
    try {
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      router.push('/emergency');
    } catch (err) {
      console.warn('[auryx][home] handleEmergency error:', err);
      Alert.alert('خطأ', 'حدث خطأ، الرجاء إعادة المحاولة');
    }
  }, [router]);

  const handleQuickLock = useCallback(() => {
    try {
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      // lock() sets isLocked=true in AuthContext, which triggers _layout to:
      //   1. call lockVaultSession() (clearing vault state)
      //   2. redirect to /lock via the nav guard
      lock();
    } catch (err) {
      console.warn('[auryx][home] handleQuickLock error:', err);
      Alert.alert('خطأ', 'حدث خطأ، الرجاء إعادة المحاولة');
    }
  }, [lock]);

  const handleBackupNow = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      t('overview.backupInfoTitle'),
      t('overview.backupInfoMsg'),
      [{ text: t('common.ok') ?? 'OK' }],
    );
  }, [t]);

  const handleDecoyVault = useCallback(() => {
    try {
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      // Lock the session silently — user enters the decoy PIN on the lock screen
      lock();
    } catch (err) {
      console.warn('[auryx][home] handleDecoyVault error:', err);
      Alert.alert('خطأ', 'حدث خطأ، الرجاء إعادة المحاولة');
    }
  }, [lock]);

  return (
    <View style={[styles.container, { backgroundColor: tc.background }]}>
      <ScreenGlow color="#F97316" icon="layers" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
        {isLegacyActive ? (
          /* ── Absence Timer Header (only AbsenceCountdownClock re-renders each second) ── */
          <AbsenceCountdownClock
            lastActiveAt={legacy.lastActiveAt ?? Date.now()}
            absenceDays={legacy.absenceDays}
            timerResetFlash={timerResetFlash}
          />
        ) : (
          /* ── Normal Header ── */
          <View>
            <Text style={styles.greeting}>{greeting}</Text>
            <Text style={styles.headerTitle}>{t('overview.title')}</Text>
          </View>
        )}
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerBtn}
            activeOpacity={0.7}
            onPress={handleOpenNotifications}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather
              name="bell"
              size={20}
              color={unreadCount > 0 ? tc.gold : tc.textSecondary}
            />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <NotificationPanel
        visible={notifPanelOpen}
        onClose={() => setNotifPanelOpen(false)}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + 20 }]}
      >
        <Animated.View pointerEvents="box-none" style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* Vault Status Circle */}
          <View style={styles.circleSection}>
            <NeonCircle
              percentage={isLegacyActive ? pctRemaining : 100}
              size={200}
              label={isLegacyActive ? `${cdDays}d` : '100%'}
              sublabel={isLegacyActive ? 'مؤقت الغياب' : t('overview.secured')}
              color={isLegacyActive ? tc.purple : tc.gold}
            />
            <Text style={[styles.syncText, isLegacyActive && { color: tc.purple }]}>
              {isLegacyActive
                ? `تجديد تلقائي عند الفتح · ${legacy.absenceDays} يوم`
                : t('overview.lastSync', { time: '2 min ago' })}
            </Text>
          </View>

          {/* Stats Grid */}
          <View style={styles.statsGrid}>
            <StatCard
              label={t('overview.assets')}
              value={items.length}
              icon="package"
              color={tc.blue}
              bgColor={tc.blueGlass}
            />
            <StatCard
              label={t('overview.guardians')}
              value={guardians.length}
              icon="users"
              color={tc.purple}
              bgColor={tc.purpleGlass}
            />
            <StatCard
              label={t('overview.alerts')}
              value={weakItems}
              icon="alert-triangle"
              color={tc.orange}
              bgColor="rgba(249,115,22,0.12)"
            />
            <StatCard
              label={t('overview.securityScore')}
              value={securityScore}
              icon="shield"
              color={tc.green}
              bgColor="rgba(34,197,94,0.12)"
            />
          </View>

          {/* Quick Protect */}
          <GlassCard style={styles.quickProtectCard} padding={20}>
            <View style={styles.quickProtectHeader}>
              <View>
                <Text style={styles.sectionTitle}>{t('overview.quickProtect')}</Text>
                <Text style={styles.sectionSubtitle}>{t('overview.customizeSecurity')}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={tc.textMuted} />
            </View>
            <View style={styles.quickActionsRow}>
              <QuickAction
                icon="lock"
                label={t('overview.lockdown')}
                color={tc.blue}
                onPress={handleQuickLock}
              />
              <QuickAction
                icon="eye-off"
                label={t('overview.decoyVault')}
                color={tc.purple}
                onPress={handleDecoyVault}
              />
              <QuickAction
                icon="zap"
                label={t('overview.emergency')}
                color={tc.red}
                onPress={handleEmergency}
              />
              <QuickAction
                icon="cloud"
                label={t('overview.backup')}
                color={tc.teal}
                onPress={handleBackupNow}
              />
            </View>
          </GlassCard>

          {/* Digital Legacy Banner */}
          <TouchableOpacity activeOpacity={0.85} onPress={() => router.push('/legacy')}>
            <LinearGradient
              colors={['rgba(139,92,246,0.20)', 'rgba(59,130,246,0.15)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.legacyBanner}
            >
              <View style={styles.legacyBannerLeft}>
                <HexagonLogo size={54} animated={false} />
              </View>
              <View style={styles.legacyBannerContent}>
                <Text style={styles.legacyTitle}>{t('legacy.title')}</Text>
                <Text style={styles.legacySubtitle}>{t('legacy.subtitle')}</Text>
                <TouchableOpacity style={styles.legacyBtn} onPress={() => router.push('/legacy')}>
                  <Text style={styles.legacyBtnText}>{t('legacy.setLegacy')}</Text>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </TouchableOpacity>

        </Animated.View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  greeting: {
    fontSize: 12,
    color: tc.textSecondary,
    fontFamily: 'Poppins_400Regular',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: tc.text,
    fontFamily: 'Poppins_700Bold',
    letterSpacing: 2,
  },
  headerRight: { flexDirection: 'row', gap: 8 },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: tc.glass,
    borderWidth: 1,
    borderColor: tc.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: tc.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 9, color: '#fff', fontWeight: '700' },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8 },
  circleSection: { alignItems: 'center', paddingVertical: 12 },
  syncText: {
    fontSize: 12,
    color: tc.green,
    fontFamily: 'Poppins_400Regular',
    marginTop: 8,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginVertical: 20,
  },
  statCard: { width: '47%', gap: 6 },
  statIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    fontFamily: 'Poppins_700Bold',
  },
  statLabel: {
    fontSize: 11,
    color: tc.textSecondary,
    fontFamily: 'Poppins_400Regular',
  },
  quickProtectCard: { marginBottom: 16 },
  quickProtectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: tc.text,
    fontFamily: 'Poppins_700Bold',
    letterSpacing: 1,
  },
  sectionSubtitle: {
    fontSize: 11,
    color: tc.textSecondary,
    fontFamily: 'Poppins_400Regular',
    marginTop: 2,
  },
  quickActionsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  quickAction: { alignItems: 'center', gap: 8, flex: 1 },
  quickActionIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  quickActionLabel: {
    fontSize: 10,
    color: tc.textSecondary,
    fontFamily: 'Poppins_400Regular',
    textAlign: 'center',
  },
  absenceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  absenceLiveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: tc.purple,
    shadowColor: tc.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
    elevation: 4,
  },
  absenceTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: tc.purple,
    fontFamily: 'Poppins_700Bold',
    letterSpacing: 1,
  },
  absenceDaysBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: 'rgba(139,92,246,0.15)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.35)',
  },
  absenceDaysBadgeText: {
    fontSize: 10,
    color: tc.purple,
    fontFamily: 'Poppins_600SemiBold',
  },
  absenceCountdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  absenceUnit: {
    alignItems: 'center',
    minWidth: 38,      // overridden inline by responsive cellMinWidth
  },
  absenceUnitValue: {
    fontSize: 26,      // overridden inline by responsive numFontSize
    fontWeight: '700',
    color: tc.text,
    fontFamily: 'Poppins_700Bold',
    letterSpacing: 1,
    lineHeight: 36,    // 1.35× of 26 — never clips descenders on Android
    includeFontPadding: false,
  },
  absenceUnitLabel: {
    fontSize: 9,
    color: tc.textMuted,
    fontFamily: 'Poppins_400Regular',
    marginTop: 2,
    lineHeight: 13,
    includeFontPadding: false,
  },
  absenceSep: {
    fontSize: 22,
    fontWeight: '700',
    color: 'rgba(139,92,246,0.50)',
    fontFamily: 'Poppins_700Bold',
    lineHeight: 36,
    marginBottom: 10,
    includeFontPadding: false,
  },
  timerResetBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(34,197,94,0.10)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.25)',
  },
  timerResetText: {
    fontSize: 9,
    color: tc.green,
    fontFamily: 'Poppins_400Regular',
  },
  legacyBanner: {
    flexDirection: 'row',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.30)',
    gap: 12,
    marginBottom: 20,
    alignItems: 'center',
  },
  legacyBannerLeft: { alignItems: 'center', justifyContent: 'center' },
  legacyBannerContent: { flex: 1 },
  legacyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: tc.text,
    fontFamily: 'Poppins_700Bold',
    letterSpacing: 1,
  },
  legacySubtitle: {
    fontSize: 11,
    color: tc.textSecondary,
    fontFamily: 'Poppins_400Regular',
    marginTop: 2,
    marginBottom: 10,
  },
  legacyBtn: {
    backgroundColor: 'rgba(212,175,55,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.40)',
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  legacyBtnText: {
    fontSize: 12,
    color: tc.gold,
    fontFamily: 'Poppins_600SemiBold',
  },
});

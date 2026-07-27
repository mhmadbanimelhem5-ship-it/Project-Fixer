/**
 * received-vault.tsx
 *
 * Screen for the beneficiary to view a vault transferred to them.
 *
 * Flow:
 *  1. User enters the vault owner's email + the 6-digit OTP from their email.
 *  2. App verifies OTP with server → server returns encrypted vault blob +
 *     RSA-encrypted transfer key (TK).
 *  3. App decrypts TK with own RSA private key → decrypts vault blob.
 *  4. Decrypted snapshot is cached in SecureStore (device-key encrypted).
 *  5. Vault items are displayed read-only with a "خزنة منقولة" badge.
 *
 * The received vault is entirely separate from the user's own vault and
 * decoy vault — it has its own storage key and cannot affect either.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme, ThemeColors } from '@/contexts/ThemeContext';
import { ScreenGlow } from '@/components/shared/ScreenGlow';
import { GlassCard } from '@/components/GlassCard';
import { unlockWithOtp, getReceivedVaultCache, type ReceivedVaultSnapshot } from '@/utils/legacyTransfer';
import { useNetworkRequired } from '@/contexts/NetworkContext';

// ── Category metadata ─────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { icon: string; color: string; label: string }> = {
  logins:    { icon: 'key',        color: '#60A5FA', label: 'كلمات المرور' },
  banking:   { icon: 'credit-card',color: '#34D399', label: 'البنوك'       },
  crypto:    { icon: 'cpu',        color: '#FBBF24', label: 'العملات'      },
  notes:     { icon: 'file-text',  color: '#A78BFA', label: 'الملاحظات'    },
  documents: { icon: 'folder',     color: '#F87171', label: 'المستندات'    },
  media:     { icon: 'image',      color: '#FB923C', label: 'الوسائط'      },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function ItemCard({ item }: { item: ReceivedVaultSnapshot['items'][number] }) {
  const [expanded, setExpanded] = useState(false);
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const meta = CATEGORY_META[item.category] ?? { icon: 'box', color: tc.textMuted, label: item.category };
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => setExpanded(e => !e)}
      style={[styles.itemCard, { borderColor: `${meta.color}30` }]}
    >
      <View style={styles.itemHeader}>
        <View style={[styles.itemIcon, { backgroundColor: `${meta.color}18` }]}>
          <Feather name={meta.icon as any} size={16} color={meta.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.itemTitle}>{item.title}</Text>
          {item.subtitle ? (
            <Text style={styles.itemSubtitle}>{item.subtitle}</Text>
          ) : null}
        </View>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={tc.textMuted} />
      </View>

      {expanded && item.plainData ? (
        <View style={styles.itemDataBox}>
          <Text style={styles.itemData}>{item.plainData}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

type Stage = 'form' | 'loading' | 'unlocked' | 'error';

export default function ReceivedVaultScreen() {
  const insets = useSafeAreaInsets();
  const router  = useRouter();
  // Accept ownerEmail pre-filled from emergency tab (after OTP verified + vault cached)
  const { owner: ownerParam } = useLocalSearchParams<{ owner?: string }>();

  const [stage,            setStage]            = useState<Stage>('form');
  const [ownerEmail,       setOwnerEmail]       = useState(ownerParam ?? '');
  const [beneficiaryEmail, setBeneficiaryEmail] = useState('');
  const [otp,              setOtp]              = useState('');
  const [errorMsg,         setErrorMsg]         = useState('');
  const [snapshot,         setSnapshot]         = useState<ReceivedVaultSnapshot | null>(null);
  const requireNetwork = useNetworkRequired();

  // On mount: if ownerEmail is pre-filled (from emergency tab param), check SecureStore cache.
  // The cache was already written by unlockWithOtp in the emergency tab, so this will
  // show the vault immediately without asking the user to enter the OTP again.
  useEffect(() => {
    const email = (ownerParam ?? '').trim().toLowerCase();
    if (!email) return;
    (async () => {
      const cached = await getReceivedVaultCache(email);
      if (cached) { setSnapshot(cached); setStage('unlocked'); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUnlock = useCallback(async () => {
    const email  = ownerEmail.trim().toLowerCase();
    const bEmail = beneficiaryEmail.trim().toLowerCase();
    const code   = otp.trim();
    if (!email || !email.includes('@')) {
      setErrorMsg('يرجى إدخال بريد صاحب الخزنة');
      return;
    }
    if (!bEmail || !bEmail.includes('@')) {
      setErrorMsg('يرجى إدخال بريدك الإلكتروني');
      return;
    }
    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      setErrorMsg('الرمز يجب أن يكون 6 أرقام');
      return;
    }
    try {
      await requireNetwork();
    } catch {
      setErrorMsg('لا يوجد اتصال بالإنترنت — تحقق من الشبكة وأعد المحاولة');
      return;
    }
    setStage('loading');
    setErrorMsg('');

    const result = await unlockWithOtp(email, code, bEmail);
    if (result.success && result.snapshot) {
      setSnapshot(result.snapshot);
      setStage('unlocked');
    } else {
      setErrorMsg(result.error ?? 'رمز خاطئ أو منتهي الصلاحية');
      setStage('error');
    }
  }, [ownerEmail, beneficiaryEmail, otp]);

  const handleCheckCache = useCallback(async () => {
    const email = ownerEmail.trim().toLowerCase();
    if (!email) return;
    const cached = await getReceivedVaultCache(email);
    if (cached) { setSnapshot(cached); setStage('unlocked'); }
  }, [ownerEmail]);

  // ── Render helpers ──────────────────────────────────────────────────────────

  const renderForm = () => (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.formContainer} keyboardShouldPersistTaps="handled">

        {/* Hero */}
        <LinearGradient colors={['rgba(212,175,55,0.18)', 'rgba(139,92,246,0.12)']} style={styles.heroBanner}>
          <View style={styles.heroIconWrap}>
            <Feather name="inbox" size={32} color={tc.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>استلام خزنة منقولة</Text>
            <Text style={styles.heroSub}>
              أدخل بريد صاحب الخزنة والرمز السري المُرسَل إليك
            </Text>
          </View>
        </LinearGradient>

        {/* Info badges */}
        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Feather name="lock" size={11} color={tc.purple} />
            <Text style={styles.badgeText}>RSA-OAEP-2048</Text>
          </View>
          <View style={styles.badge}>
            <Feather name="clock" size={11} color={tc.gold} />
            <Text style={styles.badgeText}>صالح 48 ساعة</Text>
          </View>
          <View style={styles.badge}>
            <Feather name="shield" size={11} color={tc.blue} />
            <Text style={styles.badgeText}>مشفّر من طرف إلى طرف</Text>
          </View>
        </View>

        {/* Form */}
        <GlassCard padding={20}>
          <Text style={styles.fieldLabel}>بريد صاحب الخزنة</Text>
          <TextInput
            style={styles.input}
            placeholder="owner@example.com"
            placeholderTextColor={tc.textMuted}
            value={ownerEmail}
            onChangeText={setOwnerEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            onBlur={handleCheckCache}
          />

          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>بريدك الإلكتروني</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={tc.textMuted}
            value={beneficiaryEmail}
            onChangeText={setBeneficiaryEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>الرمز السري (6 أرقام)</Text>
          <TextInput
            style={[styles.input, styles.otpInput]}
            placeholder="• • • • • •"
            placeholderTextColor={tc.textMuted}
            value={otp}
            onChangeText={t => setOtp(t.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            textAlign="center"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
          />

          {errorMsg ? (
            <View style={styles.errorBox}>
              <Feather name="alert-circle" size={12} color={tc.red} />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.unlockBtn, stage === 'loading' && { opacity: 0.6 }]}
            activeOpacity={0.85}
            disabled={stage === 'loading'}
            onPress={handleUnlock}
          >
            <LinearGradient colors={['#D4AF37', '#B8960C']} style={styles.unlockGrad}>
              {stage === 'loading' ? (
                <ActivityIndicator size="small" color="#0A0F1E" />
              ) : (
                <Feather name="unlock" size={18} color="#0A0F1E" />
              )}
              <Text style={styles.unlockText}>
                {stage === 'loading' ? 'جارٍ التحقق…' : 'فتح الخزنة'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </GlassCard>

        <Text style={styles.hint}>
          سيصلك الرمز على بريدك الإلكتروني عند نقل الخزنة إليك.{'\n'}
          إذا انتهت صلاحية الرمز، اطلب من صاحب الخزنة إعادة الإغلاق.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const renderVault = () => {
    if (!snapshot) return null;
    const grouped: Record<string, typeof snapshot.items> = {};
    for (const item of snapshot.items) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    }

    return (
      <ScrollView contentContainerStyle={styles.vaultContainer} showsVerticalScrollIndicator={false}>
        {/* Owner header */}
        <LinearGradient colors={['rgba(212,175,55,0.20)', 'rgba(139,92,246,0.15)']} style={styles.ownerBanner}>
          <View style={styles.ownerIconWrap}>
            <Feather name="inbox" size={22} color={tc.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.ownerLabel}>خزنة منقولة</Text>
            <Text style={styles.ownerName}>{snapshot.ownerName}</Text>
            <Text style={styles.ownerDate}>
              مُغلقة {new Date(snapshot.sealedAt).toLocaleDateString('ar-SA')}
            </Text>
          </View>
          <View style={styles.inheritedBadge}>
            <Feather name="shield" size={11} color={tc.gold} />
            <Text style={styles.inheritedBadgeText}>منقولة</Text>
          </View>
        </LinearGradient>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{snapshot.items.length}</Text>
            <Text style={styles.statLabel}>عنصر</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{Object.keys(grouped).length}</Text>
            <Text style={styles.statLabel}>فئة</Text>
          </View>
        </View>

        {/* Grouped items */}
        {Object.entries(grouped).map(([cat, catItems]) => {
          const meta = CATEGORY_META[cat] ?? { icon: 'box', color: tc.textMuted, label: cat };
          return (
            <View key={cat} style={styles.categorySection}>
              <View style={styles.categoryHeader}>
                <View style={[styles.categoryDot, { backgroundColor: meta.color }]} />
                <Text style={[styles.categoryLabel, { color: meta.color }]}>{meta.label}</Text>
                <Text style={styles.categoryCount}>{catItems.length}</Text>
              </View>
              {catItems.map(item => <ItemCard key={item.id} item={item} />)}
            </View>
          );
        })}

        {/* Separator note */}
        <View style={styles.separatorNote}>
          <Feather name="info" size={13} color={tc.textMuted} />
          <Text style={styles.separatorText}>
            هذه خزنة منقولة وهي مستقلة تماماً عن خزنتك الشخصية والخزنة الوهمية
          </Text>
        </View>
      </ScrollView>
    );
  };

  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <View style={[styles.container, { backgroundColor: tc.background }]}>
      <ScreenGlow color="#D4AF37" icon="inbox" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={20} color={tc.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {stage === 'unlocked' ? 'الخزنة المنقولة' : 'استلام خزنة'}
        </Text>
        <View style={{ width: 38 }} />
      </View>

      {stage === 'unlocked' ? renderVault() : renderForm()}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  container:    { flex: 1 },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12 },
  backBtn:      { width: 38, height: 38, borderRadius: 12, backgroundColor: tc.glass, borderWidth: 1, borderColor: tc.glassBorder, alignItems: 'center', justifyContent: 'center' },
  headerTitle:  { fontSize: 18, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold' },

  formContainer: { paddingHorizontal: 20, paddingBottom: 40 },
  heroBanner:    { flexDirection: 'row', borderRadius: 20, padding: 18, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)', gap: 14, alignItems: 'center', marginBottom: 16 },
  heroIconWrap:  { width: 56, height: 56, borderRadius: 16, backgroundColor: 'rgba(212,175,55,0.15)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.30)', alignItems: 'center', justifyContent: 'center' },
  heroTitle:     { fontSize: 16, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold' },
  heroSub:       { fontSize: 11, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', marginTop: 4, lineHeight: 18 },

  badgeRow:    { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  badge:       { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: tc.glass, borderRadius: 10, borderWidth: 1, borderColor: tc.glassBorder, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText:   { fontSize: 10, color: tc.textSecondary, fontFamily: 'Poppins_400Regular' },

  fieldLabel:  { fontSize: 12, color: tc.textSecondary, fontFamily: 'Poppins_600SemiBold', marginBottom: 8 },
  input:       { backgroundColor: tc.glass, borderWidth: 1, borderColor: tc.glassBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: tc.text, fontFamily: 'Poppins_400Regular', fontSize: 14 },
  otpInput:    { fontSize: 28, letterSpacing: 14, fontFamily: 'Poppins_700Bold' },

  errorBox:   { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(239,68,68,0.20)', paddingHorizontal: 10, paddingVertical: 7, marginTop: 10 },
  errorText:  { fontSize: 11, color: tc.red, fontFamily: 'Poppins_400Regular', flex: 1 },

  unlockBtn:   { borderRadius: 14, overflow: 'hidden', marginTop: 18 },
  unlockGrad:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  unlockText:  { fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold', color: '#0A0F1E' },

  hint: { fontSize: 11, color: tc.textMuted, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 18, marginTop: 20, paddingHorizontal: 10 },

  vaultContainer: { paddingHorizontal: 20, paddingBottom: 40 },
  ownerBanner:    { flexDirection: 'row', borderRadius: 20, padding: 18, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)', gap: 14, alignItems: 'center', marginBottom: 14 },
  ownerIconWrap:  { width: 46, height: 46, borderRadius: 14, backgroundColor: 'rgba(212,175,55,0.15)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.30)', alignItems: 'center', justifyContent: 'center' },
  ownerLabel:     { fontSize: 10, color: tc.gold, fontFamily: 'Poppins_600SemiBold', letterSpacing: 1 },
  ownerName:      { fontSize: 16, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold' },
  ownerDate:      { fontSize: 10, color: tc.textMuted, fontFamily: 'Poppins_400Regular', marginTop: 2 },
  inheritedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(212,175,55,0.30)', paddingHorizontal: 8, paddingVertical: 4 },
  inheritedBadgeText: { fontSize: 10, color: tc.gold, fontFamily: 'Poppins_600SemiBold' },

  statsRow:    { flexDirection: 'row', gap: 12, marginBottom: 16 },
  statCard:    { flex: 1, backgroundColor: tc.glass, borderRadius: 14, borderWidth: 1, borderColor: tc.glassBorder, alignItems: 'center', paddingVertical: 14 },
  statNumber:  { fontSize: 24, fontWeight: '700', color: tc.gold, fontFamily: 'Poppins_700Bold' },
  statLabel:   { fontSize: 11, color: tc.textSecondary, fontFamily: 'Poppins_400Regular' },

  categorySection: { marginBottom: 16 },
  categoryHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  categoryDot:     { width: 8, height: 8, borderRadius: 4 },
  categoryLabel:   { fontSize: 13, fontWeight: '600', fontFamily: 'Poppins_600SemiBold', flex: 1 },
  categoryCount:   { fontSize: 11, color: tc.textMuted, fontFamily: 'Poppins_400Regular' },

  itemCard:    { backgroundColor: tc.glass, borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 8 },
  itemHeader:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemIcon:    { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  itemTitle:   { fontSize: 13, fontWeight: '600', color: tc.text, fontFamily: 'Poppins_600SemiBold' },
  itemSubtitle:{ fontSize: 11, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', marginTop: 2 },
  itemDataBox: { marginTop: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 12 },
  itemData:    { fontSize: 12, color: tc.text, fontFamily: 'Poppins_400Regular', lineHeight: 20 },

  separatorNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', padding: 14, marginTop: 8 },
  separatorText: { fontSize: 11, color: tc.textMuted, fontFamily: 'Poppins_400Regular', flex: 1, lineHeight: 18 },
});

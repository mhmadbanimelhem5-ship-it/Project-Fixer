import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { useRouter } from 'expo-router';
import { HexagonLogo } from '@/components/HexagonLogo';
import { useVault } from '@/contexts/VaultContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme, ThemeColors } from '@/contexts/ThemeContext';
import { ScreenGlow } from '@/components/shared/ScreenGlow';

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useLanguage();
  const { legacy, updateLegacy, addAuditEntry } = useVault();
  const { colors: c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');

  // Ref prevents double-navigation if the effect fires more than once
  const hasNavigated = useRef(false);

  // Navigate to (tabs) as soon as ownerName is written to VaultContext.
  // Do NOT await saveVault() here: on first launch, the AES + 4× SecureStore
  // writes can take 2–5 s on a slow device, making the button feel frozen.
  // The 1-second debounce autosave + AppState background-save in VaultContext
  // guarantee the data is persisted even without an explicit call here.
  // The navigation guard in _layout.tsx intentionally does NOT navigate away
  // from onboarding — this is the only place that does it, avoiding the
  // double-router.replace race that caused an Android/Hermes freeze.
  useEffect(() => {
    if (legacy.ownerName && !hasNavigated.current) {
      hasNavigated.current = true;
      router.replace('/(tabs)');
    }
  }, [legacy.ownerName, router]);

  const handleContinue = () => {
    if (!name.trim()) {
      setNameError(t('onboarding.nameRequired'));
      return;
    }
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setEmailError(t('onboarding.emailRequired') || 'البريد الإلكتروني مطلوب لبروتوكول الطوارئ');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setEmailError(t('guardians.invalidEmail') || 'بريد إلكتروني غير صالح');
      return;
    }
    setNameError('');
    setEmailError('');
    updateLegacy({ ownerName: name.trim(), ownerEmail: trimmedEmail });
    addAuditEntry(`Owner profile set: ${name.trim()}`, 'app');
    // Navigation is handled by the useEffect above — it fires the moment
    // legacy.ownerName changes, with no race against the guard in _layout.tsx.
  };

  const gradColors: [string, string, string] = isDark
    ? ['#0A0F1E', '#0D1428', '#0A0F1E']
    : ['#F4F6FB', '#EAF0F8', '#F4F6FB'];

  return (
    <LinearGradient colors={gradColors} style={styles.container}>
      <ScreenGlow color="#8B5CF6" icon="user" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo */}
          <View style={styles.logoWrap}>
            <HexagonLogo size={72} />
          </View>

          {/* Title */}
          <Text style={styles.title}>{t('onboarding.title')}</Text>
          <Text style={styles.subtitle}>{t('onboarding.subtitle')}</Text>

          {/* Card */}
          <View style={styles.card}>
            <View style={styles.inputGroup}>
              <View style={styles.inputLabel}>
                <Feather name="user" size={14} color={c.gold} />
                <Text style={styles.labelText}>{t('guardians.name')}</Text>
              </View>
              <TextInput
                style={[styles.input, nameError ? styles.inputError : null]}
                placeholder={t('onboarding.namePlaceholder')}
                placeholderTextColor={c.textMuted}
                value={name}
                onChangeText={v => { setName(v); setNameError(''); }}
                autoCapitalize="words"
                returnKeyType="next"
              />
              {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}
            </View>

            <View style={styles.inputGroup}>
              <View style={styles.inputLabel}>
                <Feather name="mail" size={14} color={c.purple} />
                <Text style={styles.labelText}>{t('guardians.email')}</Text>
              </View>
              <TextInput
                style={[styles.input, emailError ? styles.inputError : null]}
                placeholder={t('onboarding.emailPlaceholder')}
                placeholderTextColor={c.textMuted}
                value={email}
                onChangeText={v => { setEmail(v); setEmailError(''); }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                spellCheck={false}
                returnKeyType="done"
                onSubmitEditing={handleContinue}
              />
              {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}
            </View>

            {/* Info note */}
            <View style={styles.infoNote}>
              <Feather name="info" size={13} color={c.textMuted} />
              <Text style={styles.infoText}>{t('onboarding.note')}</Text>
            </View>
          </View>

          {/* Actions */}
          <TouchableOpacity
            style={styles.continueBtn}
            onPress={handleContinue}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={['#D4AF37', '#B8962E']}
              style={styles.continueBtnGrad}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Text style={styles.continueBtnText}>
                {t('onboarding.continue')}
              </Text>
              <Feather name="arrow-right" size={18} color="#0A0F1E" />
            </LinearGradient>
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 24, alignItems: 'center' },
  logoWrap: { marginBottom: 28 },
  title: {
    fontSize: 26, fontWeight: '700', color: c.text,
    fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 10,
  },
  subtitle: {
    fontSize: 14, color: c.textSecondary,
    fontFamily: 'Poppins_400Regular', textAlign: 'center',
    lineHeight: 22, marginBottom: 32, paddingHorizontal: 8,
  },
  card: {
    width: '100%',
    backgroundColor: c.glass,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.20)',
    padding: 20,
    marginBottom: 24,
  },
  inputGroup: { marginBottom: 16 },
  inputLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  labelText: { fontSize: 13, color: c.textSecondary, fontFamily: 'Poppins_600SemiBold' },
  optional: { fontSize: 11, color: c.textMuted, fontFamily: 'Poppins_400Regular' },
  input: {
    backgroundColor: c.input,
    borderWidth: 1,
    borderColor: c.glassBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: c.text,
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
  },
  inputError: { borderColor: `${c.red}60` },
  errorText: { fontSize: 12, color: c.red, fontFamily: 'Poppins_400Regular', marginTop: 4 },
  infoNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: c.glass, borderRadius: 10,
    padding: 12, marginTop: 4,
  },
  infoText: {
    flex: 1, fontSize: 11, color: c.textMuted,
    fontFamily: 'Poppins_400Regular', lineHeight: 16,
  },
  continueBtn: { width: '100%', borderRadius: 16, overflow: 'hidden', marginBottom: 14 },
  continueBtnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 16,
  },
  continueBtnText: {
    fontSize: 16, fontWeight: '700', color: '#0A0F1E',
    fontFamily: 'Poppins_700Bold',
  },
  skipBtn: { paddingVertical: 10 },
  skipText: {
    fontSize: 13, color: c.textMuted,
    fontFamily: 'Poppins_400Regular', textDecorationLine: 'underline',
  },
});

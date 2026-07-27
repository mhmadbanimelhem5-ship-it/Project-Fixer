import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Clipboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { GlassCard } from '@/components/GlassCard';
import { useAuth } from '@/contexts/AuthContext';
import { useVault } from '@/contexts/VaultContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme, ThemeColors, ThemeMode } from '@/contexts/ThemeContext';
import { ScreenGlow } from '@/components/shared/ScreenGlow';
import { getStealthMode, saveStealthMode } from '@/utils/stealthStore';

/* ─── Setting row ─── */
// React.memo: settings list is long; memo prevents each row from re-rendering
// whenever an unrelated toggle changes elsewhere on the screen.
const SettingRow = React.memo(function SettingRow({
  icon, iconColor = '#D4AF37', title, subtitle,
  value, onPress, onToggle, isToggle = false, isDanger = false, showArrow = true,
}: {
  icon: string; iconColor?: string; title: string; subtitle?: string;
  value?: boolean; onPress?: () => void; onToggle?: (val: boolean) => void;
  isToggle?: boolean; isDanger?: boolean; showArrow?: boolean;
}) {
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <TouchableOpacity
      style={styles.settingRow}
      onPress={onPress}
      activeOpacity={isToggle ? 1 : 0.7}
      disabled={isToggle && !onPress}
    >
      <View style={[styles.settingIcon, { backgroundColor: `${iconColor}20` }]}>
        <Feather name={icon as any} size={18} color={iconColor} />
      </View>
      <View style={styles.settingContent}>
        <Text style={[styles.settingTitle, isDanger && { color: tc.red }]}>{title}</Text>
        {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
      </View>
      {isToggle ? (
        <Switch
          value={value}
          onValueChange={onToggle}
          trackColor={{ false: tc.glass, true: `${iconColor}60` }}
          thumbColor={value ? iconColor : tc.textSecondary}
        />
      ) : showArrow ? (
        <Feather name="chevron-right" size={16} color={tc.textMuted} />
      ) : null}
    </TouchableOpacity>
  );
});

function SectionHeader({ title }: { title: string }) {
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

/* ─── Decoy PIN modal (uses text input) ─── */
function PinSetupModal({
  visible, title, subtitle, onConfirm, onCancel, minLen = 4,
}: {
  visible: boolean; title: string; subtitle: string;
  onConfirm: (pin: string) => void; onCancel: () => void; minLen?: number;
}) {
  const { t } = useLanguage();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const handleDone = () => {
    if (pin.length < minLen) { setError(t('settings.pinMinLengthError', { n: minLen })); return; }
    if (pin !== confirm) { setError(t('settings.pinMismatchError')); return; }
    setError('');
    onConfirm(pin);
    setPin(''); setConfirm('');
  };

  const handleCancel = () => {
    setPin(''); setConfirm(''); setError('');
    onCancel();
  };

  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>{title}</Text>
          <Text style={styles.modalSubtitle}>{subtitle}</Text>
          <TextInput
            style={styles.pinInput}
            placeholder={t('settings.pinPlaceholderNew')}
            placeholderTextColor={tc.textMuted}
            value={pin}
            onChangeText={setPin}
            keyboardType="numeric"
            secureTextEntry
            maxLength={8}
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
          />
          <TextInput
            style={styles.pinInput}
            placeholder={t('settings.pinPlaceholderConfirm')}
            placeholderTextColor={tc.textMuted}
            value={confirm}
            onChangeText={setConfirm}
            keyboardType="numeric"
            secureTextEntry
            maxLength={8}
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={handleCancel}>
              <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalConfirm} onPress={handleDone}>
              <LinearGradient colors={['#D4AF37', '#B8960C']} style={styles.modalConfirmGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Text style={styles.modalConfirmText}>{t('settings.setPin')}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ─── Change PIN modal ─── */
function ChangePinModal({
  visible, onClose, verifyPin, changePin,
}: {
  visible: boolean;
  onClose: () => void;
  verifyPin: (pin: string) => Promise<boolean>;
  changePin: (current: string, newPin: string) => Promise<boolean>;
}) {
  const { t } = useLanguage();
  const [step, setStep] = useState<'current' | 'new' | 'confirm'>('current');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setStep('current'); setCurrentPin(''); setNewPin('');
    setConfirmPin(''); setError(''); setLoading(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleNext = async () => {
    setError('');
    if (step === 'current') {
      if (currentPin.length < 4) { setError(t('settings.changePinErrCurrent')); return; }
      setLoading(true);
      const ok = await verifyPin(currentPin);
      setLoading(false);
      if (!ok) { setError(t('settings.changePinErrIncorrect')); return; }
      setStep('new');
    } else if (step === 'new') {
      if (newPin.length < 4) { setError(t('settings.changePinErrMinLength')); return; }
      if (newPin === currentPin) { setError(t('settings.changePinErrSame')); return; }
      setStep('confirm');
    } else {
      if (confirmPin !== newPin) { setError(t('settings.changePinErrMismatch')); setConfirmPin(''); return; }
      setLoading(true);
      const ok = await changePin(currentPin, newPin);
      setLoading(false);
      if (!ok) {
        setError(t('settings.changePinErrGeneric'));
        reset();
      } else {
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        handleClose();
        Alert.alert(t('settings.changePinSuccessTitle'), t('settings.changePinSuccessMsg'));
      }
    }
  };

  const stepLabels = {
    current: {
      title: t('settings.changePinCurrentTitle'),
      subtitle: t('settings.changePinCurrentSub'),
      placeholder: t('settings.changePinCurrentPh'),
    },
    new: {
      title: t('settings.changePinNewTitle'),
      subtitle: t('settings.changePinNewSub'),
      placeholder: t('settings.changePinNewPh'),
    },
    confirm: {
      title: t('settings.changePinConfirmTitle'),
      subtitle: t('settings.changePinConfirmSub'),
      placeholder: t('settings.changePinConfirmPh'),
    },
  };
  const { title, subtitle, placeholder } = stepLabels[step];
  const currentValue = step === 'current' ? currentPin : step === 'new' ? newPin : confirmPin;
  const currentSetter = step === 'current' ? setCurrentPin : step === 'new' ? setNewPin : setConfirmPin;

  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.changePinHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>{title}</Text>
              <Text style={styles.modalSubtitle}>{subtitle}</Text>
            </View>
            <View style={styles.changePinSteps}>
              {(['current', 'new', 'confirm'] as const).map((s, i) => (
                <View key={s} style={[
                  styles.changePinDot,
                  step === s && styles.changePinDotActive,
                  ((step === 'new' && i === 0) || (step === 'confirm' && i <= 1)) && styles.changePinDotDone,
                ]} />
              ))}
            </View>
          </View>

          <TextInput
            style={styles.pinInput}
            placeholder={placeholder}
            placeholderTextColor={tc.textMuted}
            value={currentValue}
            onChangeText={currentSetter}
            keyboardType="numeric"
            secureTextEntry
            maxLength={8}
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={handleClose}>
              <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalConfirm} onPress={handleNext} disabled={loading}>
              <LinearGradient colors={['#D4AF37', '#B8960C']} style={styles.modalConfirmGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Text style={styles.modalConfirmText}>
                  {loading
                    ? t('settings.checking')
                    : step === 'confirm'
                    ? t('settings.savePin')
                    : t('settings.nextArrow')}
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

/* ─── Audit Log Modal ─── */
function AuditLogModal({ visible, onClose, auditLog }: {
  visible: boolean;
  onClose: () => void;
  auditLog: Array<{ id: string; action: string; timestamp: number; blockHash: string }>;
}) {
  const { t } = useLanguage();
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { maxHeight: '85%' }]}>
          <View style={styles.modalHandle} />
          <View style={styles.auditHeader}>
            <View style={styles.auditHeaderLeft}>
              <View style={[styles.settingIcon, { backgroundColor: 'rgba(139,92,246,0.15)' }]}>
                <Feather name="list" size={16} color={tc.purple} />
              </View>
              <View>
                <Text style={styles.modalTitle}>{t('settings.auditLogTitle')}</Text>
                <Text style={styles.modalSubtitle}>
                  {t('settings.auditLogEntriesCount', { count: auditLog.length })}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Feather name="x" size={18} color={tc.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
            {auditLog.length === 0 ? (
              <View style={styles.auditEmpty}>
                <Feather name="check-circle" size={32} color={tc.textMuted} />
                <Text style={styles.auditEmptyText}>{t('settings.auditLogEmpty')}</Text>
              </View>
            ) : (
              [...auditLog].reverse().map((entry, i) => (
                <View key={entry.id} style={[styles.auditEntry, i > 0 && { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }]}>
                  <View style={styles.auditDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.auditAction}>{entry.action}</Text>
                    <Text style={styles.auditTime}>{new Date(entry.timestamp).toLocaleString()}</Text>
                    <Text style={styles.auditHash} numberOfLines={1}>#{entry.blockHash.slice(0, 20)}…</Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          <TouchableOpacity style={[styles.modalConfirm, { marginTop: 12, borderRadius: 14, overflow: 'hidden' }]} onPress={onClose}>
            <LinearGradient colors={['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.04)']} style={styles.modalConfirmGrad}>
              <Text style={[styles.modalConfirmText, { color: tc.text }]}>{t('common.close')}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/* ─── Backup Modal ─── */
function BackupModal({ visible, onClose, items, guardians, legacy, encryptData }: {
  visible: boolean;
  onClose: () => void;
  items: any[];
  guardians: any[];
  legacy: any;
  encryptData: (data: string) => string;
}) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  const encryptedBackup = encryptData(JSON.stringify({ items, guardians, legacy }));

  const shortKey = encryptedBackup.slice(0, 80) + '…';

  const handleCopy = async () => {
    try {
      if (Platform.OS === 'web') {
        await (navigator as any).clipboard.writeText(encryptedBackup);
      } else {
        Clipboard.setString(encryptedBackup);
      }
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2500);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert(t('settings.copyFailedTitle'), t('settings.copyFailedMsg'));
    }
  };

  const handleDownload = () => {
    if (Platform.OS === 'web') {
      try {
        const blob = new Blob([encryptedBackup], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `auryx-backup-${Date.now()}.enc`;
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        Alert.alert(t('settings.downloadFailedTitle'), t('settings.downloadFailedMsg'));
      }
    } else {
      Alert.alert(t('settings.exportTitle'), t('settings.exportMsg'));
    }
  };

  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.auditHeader}>
            <View style={styles.auditHeaderLeft}>
              <View style={[styles.settingIcon, { backgroundColor: 'rgba(20,184,166,0.15)' }]}>
                <Feather name="cloud" size={16} color={tc.teal} />
              </View>
              <View>
                <Text style={styles.modalTitle}>{t('settings.backupTitle')}</Text>
                <Text style={styles.modalSubtitle}>{t('settings.backupSubtitle2')}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Feather name="x" size={18} color={tc.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Stats */}
          <View style={styles.backupStats}>
            {[
              { label: t('settings.backupStatItems'), value: items.length, color: tc.blue },
              { label: t('settings.backupStatGuardians'), value: guardians.length, color: tc.purple },
              { label: t('settings.backupStatEncryption'), value: 'AES-256', color: tc.teal },
            ].map((s) => (
              <View key={s.label} style={styles.backupStatCell}>
                <Text style={[styles.backupStatVal, { color: s.color }]}>{s.value}</Text>
                <Text style={styles.backupStatLbl}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* Encrypted preview */}
          <View style={styles.backupPreview}>
            <Text style={styles.backupPreviewLabel}>{t('settings.backupPreviewLabel')}</Text>
            <Text style={styles.backupPreviewText} numberOfLines={3}>{shortKey}</Text>
          </View>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={handleCopy}>
              <Feather name={copied ? 'check' : 'copy'} size={14} color={copied ? tc.green : tc.textSecondary} style={{ marginRight: 6 }} />
              <Text style={[styles.modalCancelText, copied && { color: tc.green }]}>
                {copied ? t('common.copied') : t('common.copy')}
              </Text>
            </TouchableOpacity>
            {Platform.OS === 'web' && (
              <TouchableOpacity style={styles.modalConfirm} onPress={handleDownload}>
                <LinearGradient colors={['#14B8A6', '#0D9488']} style={styles.modalConfirmGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  <Feather name="download" size={14} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={styles.modalConfirmText}>{t('settings.backupDownload')}</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ─── Edit Profile Modal ─── */
function EditProfileModal({
  visible, currentName, currentEmail, onConfirm, onCancel,
}: {
  visible: boolean; currentName: string; currentEmail: string;
  onConfirm: (name: string, email: string) => void; onCancel: () => void;
}) {
  const { t } = useLanguage();
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const [name, setName] = useState(currentName);
  const [email, setEmail] = useState(currentEmail);
  const [nameErr, setNameErr] = useState('');
  const [emailErr, setEmailErr] = useState('');

  useEffect(() => {
    if (visible) { setName(currentName); setEmail(currentEmail); setNameErr(''); setEmailErr(''); }
  }, [visible, currentName, currentEmail]);

  const handleSave = () => {
    const n = name.trim();
    const e = email.trim().toLowerCase();
    if (!n) { setNameErr(t('onboarding.nameRequired')); return; }
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { setEmailErr(t('guardians.invalidEmail')); return; }
    onConfirm(n, e);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.7)' }]}
          onPress={onCancel}
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('settings.editProfileTitle')}</Text>
            <Text style={styles.modalSubtitle}>{t('settings.editProfileSub')}</Text>

            {/* Name field */}
            <View style={styles.profileInputGroup}>
              <View style={styles.profileInputLabel}>
                <Feather name="user" size={13} color={tc.gold} />
                <Text style={styles.profileLabelText}>{t('settings.profileNameLabel')}</Text>
              </View>
              <TextInput
                style={[styles.pinInput, nameErr ? { borderColor: tc.red } : null]}
                placeholder={t('onboarding.namePlaceholder')}
                placeholderTextColor={tc.textMuted}
                value={name}
                onChangeText={v => { setName(v); setNameErr(''); }}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
              />
              {nameErr ? <Text style={styles.errorText}>{nameErr}</Text> : null}
            </View>

            {/* Email field */}
            <View style={styles.profileInputGroup}>
              <View style={styles.profileInputLabel}>
                <Feather name="mail" size={13} color={tc.purple} />
                <Text style={styles.profileLabelText}>{t('settings.profileEmailLabel')}</Text>
              </View>
              <TextInput
                style={[styles.pinInput, emailErr ? { borderColor: tc.red } : null]}
                placeholder={t('onboarding.emailPlaceholder')}
                placeholderTextColor={tc.textMuted}
                value={email}
                onChangeText={v => { setEmail(v); setEmailErr(''); }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleSave}
              />
              {emailErr ? <Text style={styles.errorText}>{emailErr}</Text> : null}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={onCancel}>
                <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleSave}>
                <LinearGradient colors={['#D4AF37', '#B8962E']} style={styles.modalConfirmGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  <Text style={styles.modalConfirmText}>{t('settings.saveProfile')}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/* ─── Confirm Modal (replaces Alert for web compatibility) ─── */
function ConfirmModal({ visible, title, message, confirmLabel, confirmColor = '#EF4444', onConfirm, onCancel }: {
  visible: boolean; title: string; message: string;
  confirmLabel: string; confirmColor?: string;
  onConfirm: () => void; onCancel: () => void;
}) {
  const { t } = useLanguage();
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { paddingBottom: 28 }]}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>{title}</Text>
          <Text style={[styles.modalSubtitle, { marginBottom: 24 }]}>{message}</Text>
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={onCancel}>
              <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalConfirm, { backgroundColor: `${confirmColor}20`, borderRadius: 14, borderWidth: 1, borderColor: `${confirmColor}40` }]}
              onPress={onConfirm}
            >
              <Text style={[styles.modalConfirmText, { color: confirmColor }]}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ─── Settings Screen ─── */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { t, language, setLanguage } = useLanguage();
  const {
    lock, wipeAll,
    biometricsEnabled, biometricsAvailable, enableBiometrics, disableBiometrics,
    setupDecoyPin, changePin, verifyPin,
  } = useAuth();
  const { items, auditLog, guardians, legacy, encryptData, updateLegacy } = useVault();

  const [decoyVaultEnabled, setDecoyVaultEnabled] = useState(false);
  const [stealthMode, setStealthMode] = useState(false);

  // Load persisted stealth mode on mount
  useEffect(() => {
    getStealthMode().then(val => setStealthMode(val));
  }, []);
  const [showDecoyModal, setShowDecoyModal] = useState(false);
  const [showChangePinModal, setShowChangePinModal] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);

  const tabBarHeight = 60 + (Platform.OS === 'web' ? 34 : insets.bottom);

  const handleBiometricsToggle = async (val: boolean) => {
    if (val) {
      if (Platform.OS === 'web') {
        Alert.alert(t('settings.biometricsNotAvailableTitle'), t('settings.biometricsNotAvailableMsg'));
        return;
      }
      if (!biometricsAvailable) {
        Alert.alert(t('settings.biometricsNotAvailableTitle'), t('settings.biometricsNotEnrolledMsg'));
        return;
      }
      const success = await enableBiometrics();
      if (!success) {
        Alert.alert(t('settings.biometricsFailedTitle'), t('settings.biometricsFailedMsg'));
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(t('settings.biometricsEnabledTitle'), t('settings.biometricsEnabledMsg'));
      }
    } else {
      Alert.alert(t('settings.disableBiometricsTitle'), t('settings.disableBiometricsMsg'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.disable'), style: 'destructive', onPress: disableBiometrics },
      ]);
    }
  };

  const handleDecoyToggle = (val: boolean) => {
    if (val) {
      setShowDecoyModal(true);
    } else {
      Alert.alert(t('settings.disableDecoyTitle'), t('settings.disableDecoyMsg'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.disable'), style: 'destructive', onPress: () => setDecoyVaultEnabled(false) },
      ]);
    }
  };

  const handleDecoyPinSet = async (pin: string) => {
    try {
      await setupDecoyPin(pin);
      setDecoyVaultEnabled(true);
      setShowDecoyModal(false);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t('settings.decoyActiveTitle'), t('settings.decoyActiveMsg'));
    } catch (err) {
      console.warn('[auryx][settings] handleDecoyPinSet error:', err);
      Alert.alert(t('settings.genericErrorTitle'), t('settings.genericErrorMsg'));
    }
  };

  const handleLogoutConfirmed = () => {
    try {
      setShowLogoutConfirm(false);
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      lock();
    } catch (err) {
      console.warn('[auryx][settings] handleLogoutConfirmed error:', err);
      Alert.alert(t('settings.genericErrorTitle'), t('settings.genericErrorMsg'));
    }
  };

  const handleWipeConfirmed = async () => {
    try {
      setShowWipeConfirm(false);
      await wipeAll();
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch (err) {
      console.warn('[auryx][settings] handleWipeConfirmed error:', err);
      Alert.alert(t('settings.genericErrorTitle'), t('settings.genericErrorMsg'));
    }
  };

  const toggleLanguage = () => {
    const newLang = language === 'en' ? 'ar' : 'en';
    setLanguage(newLang);
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const { colors: tc, mode: themeMode, setMode: setThemeMode } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);

  const modeLabels: Record<ThemeMode, string> = {
    dark:   t('settings.modeDark'),
    light:  t('settings.modeLight'),
    system: t('settings.modeSystem'),
  };

  return (
    <View style={[styles.container, { backgroundColor: tc.background }]}>
      <ScreenGlow color="#3B82F6" icon="settings" />
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
        <Text style={styles.headerTitle}>{t('settings.title')}</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + 20 }]}
      >
        {/* My Profile — owner role */}
        {legacy.userRole === 'owner' && (
          <>
            <SectionHeader title={t('settings.myProfile')} />
            <GlassCard style={styles.sectionCard} padding={0}>
              <View style={styles.profileCard}>
                <View style={styles.profileAvatarRow}>
                  <View style={styles.profileAvatar}>
                    <Text style={styles.profileAvatarText}>
                      {(legacy.ownerName ?? '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.profileName} numberOfLines={1}>
                      {legacy.ownerName ?? '—'}
                    </Text>
                    <Text style={styles.profileEmail} numberOfLines={1}>
                      {legacy.ownerEmail ?? '—'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.profileEditBtn}
                    onPress={() => setShowEditProfile(true)}
                    activeOpacity={0.7}
                  >
                    <Feather name="edit-2" size={14} color={tc.gold} />
                    <Text style={styles.profileEditText}>{t('settings.editProfile')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </GlassCard>
          </>
        )}

        {/* Connected Vault Info — beneficiary role */}
        {legacy.userRole === 'beneficiary' && (
          <>
            <SectionHeader title={t('settings.connectedVault')} />
            <GlassCard style={styles.sectionCard} padding={0}>
              <View style={styles.profileCard}>
                <View style={styles.profileAvatarRow}>
                  <View style={[styles.profileAvatar, { backgroundColor: 'rgba(212,175,55,0.15)', borderColor: 'rgba(212,175,55,0.35)' }]}>
                    <Text style={styles.profileAvatarText}>
                      {(legacy.beneficiaryOwnerName ?? legacy.ownerEmail ?? '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.profileName} numberOfLines={1}>
                      {legacy.beneficiaryOwnerName || '—'}
                    </Text>
                    <Text style={styles.profileEmail} numberOfLines={1}>
                      {legacy.ownerEmail || t('settings.noVaultLinked')}
                    </Text>
                  </View>
                  <View style={[styles.profileEditBtn, { backgroundColor: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.22)' }]}>
                    <Feather name="shield" size={13} color={tc.red} />
                    <Text style={[styles.profileEditText, { color: tc.red }]}>{t('emergency.roleBeneficiary')}</Text>
                  </View>
                </View>
              </View>
            </GlassCard>
          </>
        )}

        {/* Security */}
        <SectionHeader title={t('settings.security')} />
        <GlassCard style={styles.sectionCard} padding={0}>
          <SettingRow
            icon="key"
            title={t('settings.changePin')}
            subtitle={t('settings.changePinSub')}
            onPress={() => setShowChangePinModal(true)}
          />
          <View style={styles.rowDivider} />
          <SettingRow
            icon="activity"
            iconColor={tc.purple}
            title={t('settings.biometrics')}
            subtitle={
              Platform.OS === 'web'
                ? t('settings.biometricsSubWeb')
                : biometricsAvailable
                ? biometricsEnabled
                  ? t('settings.biometricsSubActive')
                  : t('settings.biometricsSubInactive')
                : t('settings.biometricsSubNone')
            }
            isToggle
            value={biometricsEnabled}
            onToggle={handleBiometricsToggle}
          />
          <View style={styles.rowDivider} />
          <SettingRow
            icon="eye-off"
            iconColor={tc.blue}
            title={t('settings.decoyVault')}
            subtitle={
              decoyVaultEnabled
                ? t('settings.decoyPinActive')
                : t('settings.decoyVaultSub')
            }
            isToggle
            value={decoyVaultEnabled}
            onToggle={handleDecoyToggle}
          />
          <View style={styles.rowDivider} />
          <SettingRow
            icon="cpu"
            iconColor={tc.teal}
            title={t('settings.stealthMode')}
            subtitle={t('settings.stealthModeSub')}
            isToggle
            value={stealthMode}
            onToggle={async (val: boolean) => {
              setStealthMode(val);
              await saveStealthMode(val);
              if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }}
          />
          <View style={styles.rowDivider} />
          <SettingRow
            icon="list"
            iconColor={tc.purple}
            title={t('settings.auditLog')}
            subtitle={t('settings.auditLogSubCount', { count: auditLog.length })}
            onPress={() => setShowAuditLog(true)}
          />
        </GlassCard>

        {/* Language */}
        <SectionHeader title={t('settings.language')} />
        <GlassCard style={styles.sectionCard} padding={0}>
          <TouchableOpacity style={styles.settingRow} onPress={toggleLanguage} activeOpacity={0.7}>
            <View style={[styles.settingIcon, { backgroundColor: 'rgba(59,130,246,0.15)' }]}>
              <Feather name="globe" size={18} color={tc.blue} />
            </View>
            <View style={styles.settingContent}>
              <Text style={styles.settingTitle}>{t('settings.changeLanguage')}</Text>
              <Text style={styles.settingSubtitle}>{language === 'en' ? 'English → العربية' : 'العربية → English'}</Text>
            </View>
            <View style={styles.langBadge}>
              <Text style={styles.langBadgeText}>{language === 'en' ? 'EN' : 'AR'}</Text>
            </View>
          </TouchableOpacity>
        </GlassCard>

        {/* Appearance */}
        <SectionHeader title={t('settings.appearance')} />
        <GlassCard style={styles.sectionCard} padding={0}>
          {(['dark', 'light', 'system'] as ThemeMode[]).map((m, idx, arr) => {
            const isSelected = themeMode === m;
            return (
              <React.Fragment key={m}>
                <TouchableOpacity
                  style={styles.settingRow}
                  onPress={() => {
                    setThemeMode(m);
                    if (Platform.OS !== 'web') Haptics.selectionAsync();
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.settingIcon, { backgroundColor: isSelected ? `${tc.gold}20` : `${tc.textMuted}15` }]}>
                    <Feather name={m === 'dark' ? 'moon' : m === 'light' ? 'sun' : 'smartphone'} size={18} color={isSelected ? tc.gold : tc.textMuted} />
                  </View>
                  <View style={styles.settingContent}>
                    <Text style={[styles.settingTitle, isSelected && { color: tc.gold }]}>{modeLabels[m]}</Text>
                  </View>
                  {isSelected && <Feather name="check-circle" size={18} color={tc.gold} />}
                </TouchableOpacity>
                {idx < arr.length - 1 && <View style={styles.rowDivider} />}
              </React.Fragment>
            );
          })}
        </GlassCard>

        {/* Backup */}
        <SectionHeader title={t('settings.backup')} />
        <GlassCard style={styles.sectionCard} padding={0}>
          <SettingRow
            icon="cloud"
            iconColor={tc.teal}
            title={t('settings.encryptedBackup')}
            subtitle={t('settings.backupSubExport', { count: items.length })}
            onPress={() => {
              if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowBackupModal(true);
            }}
          />
          <View style={styles.rowDivider} />
          <SettingRow
            icon="download-cloud"
            iconColor={tc.blue}
            title={t('settings.backup_now')}
            subtitle={t('settings.backupNowSub')}
            onPress={() => {
              if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowBackupModal(true);
            }}
          />
        </GlassCard>

        {/* Vault Owner Info — only visible to beneficiary-role users */}
        {legacy.userRole === 'beneficiary' && (legacy.beneficiaryOwnerName || legacy.ownerEmail) && (
          <>
            <SectionHeader title={t('settings.ownerInfo')} />
            <GlassCard style={styles.sectionCard} padding={0}>
              <View style={styles.ownerInfoCard}>
                <View style={styles.ownerInfoIconRow}>
                  <View style={[styles.settingIcon, { backgroundColor: 'rgba(212,175,55,0.15)' }]}>
                    <Feather name="shield" size={18} color={tc.gold} />
                  </View>
                  <View style={styles.settingContent}>
                    <Text style={styles.settingTitle}>{t('settings.ownerInfoDesc')}</Text>
                  </View>
                </View>
                <View style={styles.rowDivider} />
                {legacy.beneficiaryOwnerName ? (
                  <View style={styles.ownerInfoRow}>
                    <Text style={styles.ownerInfoLabel}>{t('settings.ownerInfoNameLabel')}</Text>
                    <Text style={styles.ownerInfoValue}>{legacy.beneficiaryOwnerName}</Text>
                  </View>
                ) : null}
                {legacy.ownerEmail ? (
                  <>
                    <View style={styles.rowDivider} />
                    <View style={styles.ownerInfoRow}>
                      <Text style={styles.ownerInfoLabel}>{t('settings.ownerInfoEmailLabel')}</Text>
                      <Text style={styles.ownerInfoValue} numberOfLines={1}>{legacy.ownerEmail}</Text>
                    </View>
                  </>
                ) : null}
              </View>
            </GlassCard>
          </>
        )}

        {/* Danger Zone */}
        <SectionHeader title={t('settings.danger')} />
        <GlassCard variant="red" style={styles.sectionCard} padding={0}>
          <SettingRow
            icon="log-out"
            iconColor={tc.orange}
            title={t('settings.logout')}
            subtitle={t('settings.logoutSub')}
            onPress={() => setShowLogoutConfirm(true)}
          />
          <View style={styles.rowDivider} />
          <SettingRow
            icon="trash-2"
            iconColor={tc.red}
            title={t('settings.wipeData')}
            subtitle={t('settings.wipeDataSub')}
            isDanger
            onPress={() => setShowWipeConfirm(true)}
          />
        </GlassCard>

        <Text style={styles.version}>{t('settings.appVersion')}</Text>
      </ScrollView>

      {/* ── Modals ── */}

      <PinSetupModal
        visible={showDecoyModal}
        title={t('settings.decoyPinTitle')}
        subtitle={t('settings.decoyPinSubtitle')}
        onConfirm={handleDecoyPinSet}
        onCancel={() => setShowDecoyModal(false)}
      />

      <ChangePinModal
        visible={showChangePinModal}
        onClose={() => setShowChangePinModal(false)}
        verifyPin={verifyPin}
        changePin={changePin}
      />

      <AuditLogModal
        visible={showAuditLog}
        onClose={() => setShowAuditLog(false)}
        auditLog={auditLog}
      />

      <BackupModal
        visible={showBackupModal}
        onClose={() => setShowBackupModal(false)}
        items={items}
        guardians={guardians}
        legacy={legacy}
        encryptData={encryptData}
      />

      <EditProfileModal
        visible={showEditProfile}
        currentName={legacy.ownerName ?? ''}
        currentEmail={legacy.ownerEmail ?? ''}
        onConfirm={(name, email) => {
          updateLegacy({ ownerName: name, ownerEmail: email });
          setShowEditProfile(false);
        }}
        onCancel={() => setShowEditProfile(false)}
      />

      <ConfirmModal
        visible={showLogoutConfirm}
        title={t('settings.logout')}
        message={t('settings.logoutMessage')}
        confirmLabel={t('settings.lockLogout')}
        confirmColor={tc.orange}
        onConfirm={handleLogoutConfirmed}
        onCancel={() => setShowLogoutConfirm(false)}
      />

      <ConfirmModal
        visible={showWipeConfirm}
        title={t('settings.wipeTitle')}
        message={t('settings.wipeMessage')}
        confirmLabel={t('settings.wipeEverything')}
        confirmColor={tc.red}
        onConfirm={handleWipeConfirmed}
        onCancel={() => setShowWipeConfirm(false)}
      />
    </View>
  );
}

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  headerTitle: {
    fontSize: 22, fontWeight: '700', color: tc.text,
    fontFamily: 'Poppins_700Bold', letterSpacing: 2,
  },
  scrollContent: { paddingHorizontal: 20 },
  sectionHeader: {
    fontSize: 11, fontWeight: '700', color: tc.textMuted,
    fontFamily: 'Poppins_700Bold', letterSpacing: 1.5,
    textTransform: 'uppercase', marginTop: 24, marginBottom: 8, marginLeft: 4,
  },
  sectionCard: { overflow: 'hidden' },
  settingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  settingIcon: {
    width: 38, height: 38, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  settingContent: { flex: 1 },
  settingTitle: { fontSize: 14, fontWeight: '600', color: tc.text, fontFamily: 'Poppins_600SemiBold' },
  settingSubtitle: { fontSize: 11, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', marginTop: 1 },
  rowDivider: { height: 1, backgroundColor: tc.separator, marginLeft: 68 },
  langBadge: {
    paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8,
    backgroundColor: tc.blueGlass, borderWidth: 1, borderColor: 'rgba(59,130,246,0.30)',
  },
  langBadgeText: { fontSize: 12, fontWeight: '700', color: tc.blue, fontFamily: 'Poppins_700Bold' },
  version: {
    textAlign: 'center', fontSize: 12, color: tc.textMuted,
    fontFamily: 'Poppins_400Regular', marginTop: 24, marginBottom: 8,
  },
  // Modal shared
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#0D1428', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 44,
    borderTopWidth: 1, borderColor: 'rgba(212,175,55,0.20)',
  },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: tc.glass, alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold', marginBottom: 6 },
  modalSubtitle: { fontSize: 12, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', marginBottom: 20, lineHeight: 18 },
  pinInput: {
    backgroundColor: tc.glass, borderWidth: 1, borderColor: tc.glassBorder,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14,
    color: tc.text, fontFamily: 'Poppins_400Regular',
    fontSize: 18, marginBottom: 12, letterSpacing: 6, textAlign: 'center',
  },
  errorText: {
    fontSize: 12, color: tc.red, fontFamily: 'Poppins_400Regular',
    marginBottom: 8, textAlign: 'center',
  },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  modalCancel: {
    flex: 1, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center',
    backgroundColor: tc.glass, borderRadius: 14,
    borderWidth: 1, borderColor: tc.glassBorder,
  },
  modalCancelText: { color: tc.textSecondary, fontFamily: 'Poppins_600SemiBold', fontSize: 14 },
  modalConfirm: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  modalConfirmGrad: { paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  modalConfirmText: { color: '#fff', fontWeight: '700', fontFamily: 'Poppins_700Bold', fontSize: 14 },
  closeBtn: { padding: 4 },
  // Change PIN header
  changePinHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 4 },
  changePinSteps: { flexDirection: 'row', gap: 6, paddingTop: 6 },
  changePinDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: tc.glass, borderWidth: 1, borderColor: tc.glassBorder,
  },
  changePinDotActive: { backgroundColor: tc.gold, borderColor: tc.gold },
  changePinDotDone: { backgroundColor: tc.green, borderColor: tc.green },
  // Audit log
  auditHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  auditHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  auditEmpty: { alignItems: 'center', gap: 12, paddingVertical: 32 },
  auditEmptyText: { fontSize: 13, color: tc.textMuted, fontFamily: 'Poppins_400Regular' },
  auditEntry: { flexDirection: 'row', gap: 12, paddingVertical: 10 },
  auditDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: tc.purple, marginTop: 4 },
  auditAction: { fontSize: 12, color: tc.text, fontFamily: 'Poppins_400Regular', lineHeight: 18 },
  auditTime: { fontSize: 10, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', marginTop: 2 },
  auditHash: { fontSize: 9, color: tc.textMuted, fontFamily: 'Poppins_400Regular', marginTop: 1 },
  // Backup
  backupStats: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  backupStatCell: { flex: 1, alignItems: 'center', paddingVertical: 12, backgroundColor: tc.glass, borderRadius: 12, borderWidth: 1, borderColor: tc.glassBorder },
  backupStatVal: { fontSize: 18, fontWeight: '700', fontFamily: 'Poppins_700Bold' },
  backupStatLbl: { fontSize: 10, color: tc.textMuted, fontFamily: 'Poppins_400Regular', marginTop: 2 },
  backupPreview: { backgroundColor: tc.glass, borderRadius: 12, borderWidth: 1, borderColor: tc.glassBorder, padding: 12, marginBottom: 16 },
  backupPreviewLabel: { fontSize: 9, letterSpacing: 1.5, color: tc.textMuted, fontFamily: 'Poppins_700Bold', textTransform: 'uppercase', marginBottom: 6 },
  backupPreviewText: { fontSize: 11, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', lineHeight: 16 },
  // My Profile (owner view)
  profileCard: { padding: 16 },
  profileAvatarRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  profileAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(212,175,55,0.15)',
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  profileAvatarText: { fontSize: 20, fontWeight: '700', color: tc.gold, fontFamily: 'Poppins_700Bold' },
  profileName: { fontSize: 15, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold' },
  profileEmail: { fontSize: 12, color: tc.textMuted, fontFamily: 'Poppins_400Regular', marginTop: 2 },
  profileEditBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: 'rgba(212,175,55,0.12)',
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  profileEditText: { fontSize: 12, color: tc.gold, fontFamily: 'Poppins_600SemiBold' },
  profileInputGroup: { marginBottom: 14 },
  profileInputLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  profileLabelText: { fontSize: 12, color: tc.textSecondary, fontFamily: 'Poppins_600SemiBold' },
  // Vault owner info (beneficiary view)
  ownerInfoCard: { overflow: 'hidden' },
  ownerInfoIconRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  ownerInfoRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 16, gap: 12,
  },
  ownerInfoLabel: { fontSize: 12, color: tc.textMuted, fontFamily: 'Poppins_400Regular' },
  ownerInfoValue: { fontSize: 13, color: tc.gold, fontFamily: 'Poppins_600SemiBold', flex: 1, textAlign: 'right' },
});

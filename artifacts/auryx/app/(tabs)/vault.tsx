import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
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
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { GlassCard } from '@/components/GlassCard';
import { useVault, VaultCategory, VaultItem } from '@/contexts/VaultContext';
import { useLanguage } from '@/contexts/LanguageContext';
import colors from '@/constants/colors';
import { useTheme, ThemeColors } from '@/contexts/ThemeContext';

const _tc = colors.dark; // module-level fallback for CATEGORIES 0026 STRENGTH_COLORS
import { ScreenGlow } from '@/components/shared/ScreenGlow';
import {
  clearMediaTemp,
  MediaKind,
  pickDocument,
  pickImage,
  pickVideo,
} from '@/utils/mediaStorage';

type CategoryConfig = {
  key: VaultCategory;
  labelKey: string;
  icon: string;
  color: string;
  angle: number;
};

const CATEGORIES: CategoryConfig[] = [
  { key: 'logins',    labelKey: 'vault.logins',    icon: 'user',        color: _tc.blue,  angle: -90 },
  { key: 'media',     labelKey: 'vault.media',     icon: 'image',       color: _tc.purple,angle: -30 },
  { key: 'banking',   labelKey: 'vault.banking',   icon: 'credit-card', color: _tc.gold,  angle: 30  },
  { key: 'notes',     labelKey: 'vault.notes',     icon: 'file-text',   color: _tc.teal,  angle: 90  },
  { key: 'documents', labelKey: 'vault.documents', icon: 'folder',      color: _tc.orange,angle: 150 },
  { key: 'crypto',    labelKey: 'vault.crypto',    icon: 'cpu',         color: _tc.green, angle: 210 },
];

const STRENGTH_COLORS = {
  weak: _tc.red,
  fair: _tc.orange,
  strong: _tc.blue,
  very_strong: _tc.green,
};

function getCatConfig(key: VaultCategory) {
  return CATEGORIES.find(c => c.key === key) ?? CATEGORIES[0];
}

// Pure function — no closure captures, safe as module-level constant
function getPasswordStrength(pw: string): keyof typeof STRENGTH_COLORS {
  if (pw.length < 6) return 'weak';
  if (pw.length < 10) return 'fair';
  if (/[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[!@#$%^&*]/.test(pw)) return 'very_strong';
  return 'strong';
}

// React.memo: each orb only re-renders when its own count, selected state, or handler changes
const CategoryOrb = React.memo(function CategoryOrb({ config, count, onPress, selected }: { config: CategoryConfig; count: number; onPress: () => void; selected: boolean }) {
  const { t } = useLanguage();
  const R = 110;
  const rad = (config.angle * Math.PI) / 180;
  const x = R * Math.cos(rad);
  const y = R * Math.sin(rad);
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <View style={[styles.orbWrapper, { transform: [{ translateX: x }, { translateY: y }] }]}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.75}
        style={[styles.orb, { borderColor: selected ? config.color : `${config.color}55` }, selected && { backgroundColor: `${config.color}22` }]}
      >
        <Feather name={config.icon as any} size={18} color={config.color} />
        <Text style={[styles.orbCount, { color: config.color }]}>{count}</Text>
      </TouchableOpacity>
      <Text style={[styles.orbLabel, { color: selected ? config.color : tc.textSecondary }]}>
        {t(config.labelKey)}
      </Text>
    </View>
  );
});

function AddItemModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const { addItem } = useVault();
  const [title, setTitle]         = useState('');
  const [subtitle, setSubtitle]   = useState('');
  const [selectedCat, setSelectedCat] = useState<VaultCategory>('logins');
  const [password, setPassword]   = useState('');
  const [showPw, setShowPw]       = useState(false);

  const handleAdd = () => {
    if (!title.trim()) return;
    addItem({ category: selectedCat, title: title.trim(), subtitle: subtitle.trim(), encryptedData: password, strength: getPasswordStrength(password), tags: [] });
    setTitle(''); setSubtitle(''); setPassword(''); setSelectedCat('logins');
    onClose();
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>{t('vault.addNew')}</Text>

          <View style={styles.catSelector}>
            {CATEGORIES.map(c => (
              <TouchableOpacity
                key={c.key}
                style={[styles.catChip, { borderColor: selectedCat === c.key ? c.color : tc.border }, selectedCat === c.key && { backgroundColor: `${c.color}20` }]}
                onPress={() => setSelectedCat(c.key)}
              >
                <Feather name={c.icon as any} size={12} color={selectedCat === c.key ? c.color : tc.textSecondary} />
                <Text style={[styles.catChipText, { color: selectedCat === c.key ? c.color : tc.textSecondary }]}>{t(c.labelKey)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.modalInput}
            placeholder={t('vault.titlePlaceholder')}
            placeholderTextColor={tc.textMuted}
            value={title}
            onChangeText={setTitle}
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            returnKeyType="next"
          />
          <TextInput
            style={styles.modalInput}
            placeholder={t('vault.subtitlePlaceholder')}
            placeholderTextColor={tc.textMuted}
            value={subtitle}
            onChangeText={setSubtitle}
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            returnKeyType="next"
          />

          <View style={styles.pwRow}>
            <TextInput
              style={[styles.modalInput, { flex: 1, marginBottom: 0 }]}
              placeholder={t('vault.secretPlaceholder')}
              placeholderTextColor={tc.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              returnKeyType="done"
              onSubmitEditing={handleAdd}
            />
            <TouchableOpacity style={styles.eyeToggle} onPress={() => setShowPw(v => !v)}>
              <Feather name={showPw ? 'eye-off' : 'eye'} size={18} color={tc.textSecondary} />
            </TouchableOpacity>
          </View>

          {password.length > 0 && (
            <View style={styles.strengthRow}>
              <View style={[styles.strengthBar, { backgroundColor: STRENGTH_COLORS[getPasswordStrength(password)] }]} />
              <Text style={[styles.strengthLabel, { color: STRENGTH_COLORS[getPasswordStrength(password)] }]}>
                {getPasswordStrength(password) === 'very_strong' ? t('vault.veryStrong') : getPasswordStrength(password) === 'strong' ? t('vault.strong') : getPasswordStrength(password) === 'fair' ? t('vault.fair') : t('vault.weak')}
              </Text>
            </View>
          )}

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalConfirm} onPress={handleAdd}>
              <LinearGradient colors={['#D4AF37', '#B8960C']} style={styles.modalConfirmGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
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

function EditItemModal({ item, onClose }: { item: VaultItem | null; onClose: () => void }) {
  const { updateItem } = useVault();
  const { t } = useLanguage();
  const [title, setTitle]       = useState(item?.title ?? '');
  const [subtitle, setSubtitle] = useState(item?.subtitle ?? '');
  const [password, setPassword] = useState(item?.encryptedData ?? '');
  const [showPw, setShowPw]     = useState(false);
  // ⚠️ Hooks MUST all be called before any early return (Rules of Hooks).
  // useTheme/useMemo were previously placed after `if (!item) return null`
  // which caused a hook-count mismatch crash when item transitioned null→value.
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);

  React.useEffect(() => {
    if (item) {
      setTitle(item.title);
      setSubtitle(item.subtitle ?? '');
      setPassword(item.encryptedData ?? '');
    }
  }, [item]);

  const handleSave = () => {
    if (!item || !title.trim()) return;
    updateItem(item.id, { title: title.trim(), subtitle: subtitle.trim(), encryptedData: password, strength: getPasswordStrength(password) });
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
  };

  if (!item) return null;

  const cat = getCatConfig(item.category);
  return (
    <Modal visible={!!item} animationType="slide" transparent presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <View style={[styles.editCatIcon, { backgroundColor: `${cat.color}20` }]}>
              <Feather name={cat.icon as any} size={18} color={cat.color} />
            </View>
            <Text style={styles.modalTitle}>{t('vault.editItem')}</Text>
          </View>

          <TextInput
            style={styles.modalInput}
            placeholder={t('vault.titlePlaceholder')}
            placeholderTextColor={tc.textMuted}
            value={title}
            onChangeText={setTitle}
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            returnKeyType="next"
          />
          <TextInput
            style={styles.modalInput}
            placeholder={t('vault.subtitlePlaceholder')}
            placeholderTextColor={tc.textMuted}
            value={subtitle}
            onChangeText={setSubtitle}
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            returnKeyType="next"
          />

          <View style={styles.pwRow}>
            <TextInput
              style={[styles.modalInput, { flex: 1, marginBottom: 0 }]}
              placeholder={t('vault.secretPlaceholder')}
              placeholderTextColor={tc.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
            <TouchableOpacity style={styles.eyeToggle} onPress={() => setShowPw(v => !v)}>
              <Feather name={showPw ? 'eye-off' : 'eye'} size={18} color={tc.textSecondary} />
            </TouchableOpacity>
          </View>

          {password.length > 0 && (
            <View style={styles.strengthRow}>
              <View style={[styles.strengthBar, { backgroundColor: STRENGTH_COLORS[getPasswordStrength(password)] }]} />
              <Text style={[styles.strengthLabel, { color: STRENGTH_COLORS[getPasswordStrength(password)] }]}>
                {getPasswordStrength(password) === 'very_strong' ? t('vault.veryStrong') : getPasswordStrength(password) === 'strong' ? t('vault.strong') : getPasswordStrength(password) === 'fair' ? t('vault.fair') : t('vault.weak')}
              </Text>
            </View>
          )}

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalConfirm} onPress={handleSave}>
              <LinearGradient colors={['#D4AF37', '#B8960C']} style={styles.modalConfirmGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
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

function ViewItemModal({ item, onClose }: { item: VaultItem | null; onClose: () => void }) {
  const [showSecret, setShowSecret] = useState(false);
  // ⚠️ Hooks MUST all be called before any early return (Rules of Hooks).
  const { t } = useLanguage();
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);

  React.useEffect(() => {
    if (!item) setShowSecret(false);
  }, [item]);

  if (!item) return null;
  const cat = getCatConfig(item.category);
  return (
    <Modal visible={!!item} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.viewOverlay}>
        <View style={styles.viewSheet}>
          <View style={[styles.viewCatIcon, { backgroundColor: `${cat.color}20` }]}>
            <Feather name={cat.icon as any} size={28} color={cat.color} />
          </View>
          <Text style={styles.viewTitle}>{item.title}</Text>
          {item.subtitle ? <Text style={styles.viewSubtitle}>{item.subtitle}</Text> : null}

          {item.strength && (
            <View style={[styles.strengthPill, { backgroundColor: `${STRENGTH_COLORS[item.strength]}20`, borderColor: `${STRENGTH_COLORS[item.strength]}50` }]}>
              <View style={[styles.strengthDot2, { backgroundColor: STRENGTH_COLORS[item.strength] }]} />
              <Text style={[styles.strengthPillText, { color: STRENGTH_COLORS[item.strength] }]}>
                {item.strength === 'very_strong' ? t('vault.veryStrong') : item.strength === 'strong' ? t('vault.strong') : item.strength === 'fair' ? t('vault.fair') : t('vault.weak')}
              </Text>
            </View>
          )}

          {item.encryptedData ? (
            <View style={styles.secretBox}>
              <Text style={styles.secretLabel}>{t('vault.secretLabel')}</Text>
              <View style={styles.secretRow}>
                <Text style={styles.secretValue} numberOfLines={showSecret ? undefined : 1}>
                  {showSecret ? item.encryptedData : '••••••••••••'}
                </Text>
                <TouchableOpacity onPress={() => setShowSecret(v => !v)} style={styles.secretEye}>
                  <Feather name={showSecret ? 'eye-off' : 'eye'} size={18} color={tc.gold} />
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <TouchableOpacity style={styles.viewClose} onPress={onClose}>
            <LinearGradient colors={['#D4AF37', '#B8960C']} style={styles.viewCloseGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
              <Text style={styles.viewCloseText}>{t('common.close')}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MEDIA_ICON: Record<MediaKind, string> = { image: 'image', video: 'video', file: 'file' };
const MEDIA_COLOR: Record<MediaKind, string> = {
  image: _tc.purple,
  video: _tc.blue,
  file: _tc.orange,
};

function MediaThumb({ item }: { item: VaultItem }) {
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const { getMediaPreview, mediaSessionVersion } = useVault();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const kind = item.mediaKind ?? 'file';

  // Decrypt the image preview. Driven only by item identity so a session wipe
  // can never trigger a fresh decrypt with a still-present key.
  useEffect(() => {
    let active = true;
    if (kind === 'image' && item.mediaRef) {
      getMediaPreview(item)
        .then(u => { if (active) setUri(u); })
        .catch(() => { if (active) setFailed(true); });
    }
    return () => { active = false; };
  }, [item.id]);

  // Reset-only: drop the decrypted preview from state whenever the session is
  // wiped (lock / logout / decoy). Never re-decrypts.
  useEffect(() => {
    setUri(null);
    setFailed(false);
  }, [mediaSessionVersion]);

  if (kind === 'image' && uri && !failed) {
    return <Image source={{ uri }} style={styles.mediaThumbImg} contentFit="cover" transition={150} />;
  }
  return (
    <View style={styles.mediaThumbPlaceholder}>
      {kind === 'image' && !failed ? (
        <ActivityIndicator color={tc.purple} />
      ) : (
        <Feather name={MEDIA_ICON[kind] as any} size={26} color={MEDIA_COLOR[kind]} />
      )}
    </View>
  );
}

function MediaCard({ item, onOpen, onLongPress }: {
  item: VaultItem;
  onOpen: (item: VaultItem) => void;
  onLongPress: (item: VaultItem) => void;
}) {
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <TouchableOpacity
      style={styles.mediaCard}
      activeOpacity={0.8}
      onPress={() => onOpen(item)}
      onLongPress={() => {
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onLongPress(item);
      }}
      delayLongPress={350}
    >
      <MediaThumb item={item} />
      {item.mediaKind === 'video' && (
        <View style={styles.mediaPlayBadge}>
          <Feather name="play" size={12} color="#FFFFFF" />
        </View>
      )}
      <View style={styles.mediaCardLabel}>
        <Text style={styles.mediaCardText} numberOfLines={1}>{item.title}</Text>
      </View>
    </TouchableOpacity>
  );
}

// Bottom sheet that appears on long-press of a media card.
// Offers حذف (delete) and نقل إلى الجهاز (share-out / export).
function MediaActionSheet({ item, onClose, onDelete, onShare }: {
  item: VaultItem | null;
  onClose: () => void;
  onDelete: (item: VaultItem) => void;
  onShare: (item: VaultItem) => void;
}) {
  if (!item) return null;
  const kind = item.mediaKind ?? 'file';
  const color = MEDIA_COLOR[kind];
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <Modal visible={!!item} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.actionOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.actionSheet}>
          <View style={styles.actionHandle} />
          {/* Item header */}
          <View style={styles.actionHeader}>
            <View style={[styles.actionKindIcon, { backgroundColor: `${color}20` }]}>
              <Feather name={MEDIA_ICON[kind] as any} size={20} color={color} />
            </View>
            <Text style={styles.actionItemName} numberOfLines={2}>{item.title}</Text>
          </View>
          <View style={styles.actionDivider} />
          {/* Share / export — native only (expo-sharing unavailable on web) */}
          {Platform.OS !== 'web' && (
            <TouchableOpacity
              style={styles.actionRow}
              activeOpacity={0.75}
              onPress={() => { onClose(); onShare(item); }}
            >
              <View style={[styles.actionIconWrap, { backgroundColor: 'rgba(59,130,246,0.15)' }]}>
                <Feather name="share-2" size={18} color={tc.blue} />
              </View>
              <Text style={styles.actionLabel}>نقل إلى الجهاز</Text>
              <Feather name="chevron-right" size={14} color={tc.textMuted} style={{ marginLeft: 'auto' }} />
            </TouchableOpacity>
          )}
          {/* Delete */}
          <TouchableOpacity
            style={styles.actionRow}
            activeOpacity={0.75}
            onPress={() => { onClose(); onDelete(item); }}
          >
            <View style={[styles.actionIconWrap, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
              <Feather name="trash-2" size={18} color={tc.red} />
            </View>
            <Text style={[styles.actionLabel, { color: tc.red }]}>حذف</Text>
            <Feather name="chevron-right" size={14} color={tc.red} style={{ marginLeft: 'auto', opacity: 0.5 }} />
          </TouchableOpacity>
          {/* Cancel */}
          <TouchableOpacity style={styles.actionCancel} activeOpacity={0.75} onPress={onClose}>
            <Text style={styles.actionCancelText}>إلغاء</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

function VaultVideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, p => { p.loop = false; p.play(); });
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <VideoView
      style={styles.viewerVideo}
      player={player}
      contentFit="contain"
      allowsFullscreen
      nativeControls
    />
  );
}

function MediaViewerModal({ item, onClose, onDelete }: { item: VaultItem | null; onClose: () => void; onDelete: (item: VaultItem) => void }) {
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const { t } = useLanguage();
  const { getMediaPreview, getMediaTempFile, exportMedia, shareMedia } = useVault();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setImageUri(null);
    setVideoUri(null);
    setError(false);
    if (!item) return;
    if (item.mediaKind === 'image') {
      setLoading(true);
      getMediaPreview(item)
        .then(u => { if (active) setImageUri(u); })
        .catch(() => { if (active) setError(true); })
        .finally(() => { if (active) setLoading(false); });
    } else if (item.mediaKind === 'video') {
      setLoading(true);
      getMediaTempFile(item)
        .then(u => { if (active) setVideoUri(u); })
        .catch(() => { if (active) setError(true); })
        .finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [item?.id]);

  // Belt-and-suspenders: wipe decrypted temp files if the viewer unmounts
  // (e.g. an auto-lock unmounts the tree) without an explicit close.
  useEffect(() => () => { clearMediaTemp(); }, []);

  const handleClose = () => {
    clearMediaTemp();
    onClose();
  };

  const handleShare = async () => {
    if (!item) return;
    try {
      await shareMedia(item);
    } catch {
      Alert.alert(t('common.error'), t('vault.shareUnavailable'));
    }
  };

  const handleExport = async () => {
    if (!item) return;
    try {
      await exportMedia(item);
    } catch {
      Alert.alert(t('common.error'), t('vault.shareUnavailable'));
    }
  };

  if (!item) return null;
  const kind = item.mediaKind ?? 'file';

  return (
    <Modal visible={!!item} animationType="fade" transparent onRequestClose={handleClose}>
      <View style={styles.viewerOverlay}>
        <View style={styles.viewerSheet}>
          <View style={styles.viewerHeader}>
            <Text style={styles.viewerTitle} numberOfLines={1}>{item.title}</Text>
            <TouchableOpacity onPress={handleClose} style={styles.viewerCloseBtn}>
              <Feather name="x" size={20} color={tc.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.viewerBody}>
            {loading && <ActivityIndicator color={tc.gold} size="large" />}
            {!loading && error && (
              <View style={styles.viewerFallback}>
                <Feather name="alert-triangle" size={30} color={tc.red} />
                <Text style={styles.viewerFallbackText}>{t('vault.mediaLoadError')}</Text>
              </View>
            )}
            {!loading && !error && kind === 'image' && imageUri && (
              <Image source={{ uri: imageUri }} style={styles.viewerImage} contentFit="contain" />
            )}
            {!loading && !error && kind === 'video' && videoUri && (
              <VaultVideoPlayer uri={videoUri} />
            )}
            {!loading && !error && kind === 'file' && (
              <View style={styles.viewerFallback}>
                <View style={styles.viewerFileIcon}>
                  <Feather name="file" size={34} color={tc.orange} />
                </View>
                <Text style={styles.viewerFileName} numberOfLines={2}>{item.fileName ?? item.title}</Text>
                {item.fileSize ? <Text style={styles.viewerFileMeta}>{formatBytes(item.fileSize)}</Text> : null}
                <Text style={styles.viewerFileHint}>{t('vault.fileOpenHint')}</Text>
              </View>
            )}
          </View>

          <View style={styles.viewerActions}>
            {Platform.OS !== 'web' && (
              <TouchableOpacity style={styles.viewerActionBtn} onPress={handleShare}>
                <Feather name="share-2" size={16} color={tc.blue} />
                <Text style={[styles.viewerActionText, { color: tc.blue }]}>{t('vault.share')}</Text>
              </TouchableOpacity>
            )}
            {Platform.OS !== 'web' && (
              <TouchableOpacity style={styles.viewerActionBtn} onPress={handleExport}>
                <Feather name="download" size={16} color={tc.gold} />
                <Text style={[styles.viewerActionText, { color: tc.gold }]}>{t('vault.exportEncrypted')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.viewerActionBtn} onPress={() => { handleClose(); onDelete(item); }}>
              <Feather name="trash-2" size={16} color={tc.red} />
              <Text style={[styles.viewerActionText, { color: tc.red }]}>{t('common.delete')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function MediaSection({ items, decoyMode, busy, onAdd, onOpen, onLongPress }: {
  items: VaultItem[];
  decoyMode: boolean;
  busy: boolean;
  onAdd: (kind: MediaKind) => void;
  onOpen: (item: VaultItem) => void;
  onLongPress: (item: VaultItem) => void;
}) {
  const { t } = useLanguage();
  const addButtons: { kind: MediaKind; icon: string; labelKey: string }[] = [
    { kind: 'image', icon: 'image',     labelKey: 'vault.addImage' },
    { kind: 'video', icon: 'video',     labelKey: 'vault.addVideo' },
    { kind: 'file',  icon: 'file-plus', labelKey: 'vault.addFile'  },
  ];
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <View>
      <View style={styles.mediaAddRow}>
        {addButtons.map(b => (
          <TouchableOpacity
            key={b.kind}
            style={[styles.mediaAddBtn, busy && { opacity: 0.5 }]}
            activeOpacity={0.8}
            disabled={busy}
            onPress={() => onAdd(b.kind)}
          >
            <Feather name={b.icon as any} size={18} color={tc.purple} />
            <Text style={styles.mediaAddText}>{t(b.labelKey)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="image" size={40} color={tc.textMuted} />
          <Text style={styles.emptyText}>{decoyMode ? t('vault.noMediaDecoy') : t('vault.noMedia')}</Text>
        </View>
      ) : (
        <View style={styles.mediaGrid}>
          {items.map(item => (
            <MediaCard key={item.id} item={item} onOpen={onOpen} onLongPress={onLongPress} />
          ))}
        </View>
      )}
    </View>
  );
}

export default function VaultScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { items, getItemsByCategory, removeItem, getWeakItemsCount, addMediaItem, shareMedia, decoyMode, mediaSessionVersion } = useVault();

  // Memoised per-category counts so CATEGORIES.map() in the orb grid never
  // triggers 6 separate array filters on every render.
  const categoryCounts = useMemo(
    () => Object.fromEntries(CATEGORIES.map(c => [c.key, getItemsByCategory(c.key).length])),
    // items changes identity on every vault mutation — that is the only signal
    // we need; getItemsByCategory is a stable useCallback in VaultContext.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items],
  );

  const [selectedCat, setSelectedCat] = useState<VaultCategory | null>(null);
  const [showAdd, setShowAdd]   = useState(false);
  const [editItem, setEditItem] = useState<VaultItem | null>(null);
  const [viewItem, setViewItem] = useState<VaultItem | null>(null);
  const [mediaViewItem, setMediaViewItem] = useState<VaultItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [lpItem, setLpItem] = useState<VaultItem | null>(null);

  // Lightweight in-app toast for delete success/error feedback (cross-platform:
  // ToastAndroid is Android-only, so we roll our own fading banner).
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, error });
    Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: Platform.OS !== 'web' }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 250, useNativeDriver: Platform.OS !== 'web' })
        .start(({ finished }) => { if (finished) setToast(null); });
    }, 2200);
  }, [toastOpacity]);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Close the media viewer when the session is wiped (lock / logout / decoy)
  // so an open viewer can't keep pointing at real decrypted media. Skip the
  // initial mount (version 0) so we don't fight normal open/close.
  useEffect(() => {
    if (mediaSessionVersion === 0) return;
    setMediaViewItem(null);
  }, [mediaSessionVersion]);
  const tabBarHeight = 60 + (Platform.OS === 'web' ? 34 : insets.bottom);
  const weakCount = getWeakItemsCount();
  const displayItems = selectedCat ? getItemsByCategory(selectedCat) : items;

  const handleAddMedia = async (kind: MediaKind) => {
    const picker = kind === 'image' ? pickImage : kind === 'video' ? pickVideo : pickDocument;
    const res = await picker();
    if (!res.ok) {
      if (res.reason === 'too_large') Alert.alert(t('vault.mediaTooLargeTitle'), t('vault.mediaTooLarge'));
      else if (res.reason === 'permission') Alert.alert(t('vault.permTitle'), t('vault.permMsg'));
      else if (res.reason === 'error') Alert.alert(t('common.error'), t('vault.mediaAddError'));
      return;
    }
    setBusy(true);
    try {
      await addMediaItem(res.data, '');
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert(t('common.error'), t('vault.mediaAddError'));
    } finally {
      setBusy(false);
    }
  };

  // Open the in-app confirmation modal. NOTE: React Native's Alert.alert with
  // multiple buttons is a NO-OP on React Native Web (no dialog appears and the
  // button callbacks never fire), which is why the delete button "did nothing"
  // in the web preview. The confirm step MUST be a real in-app Modal so it works
  // on web + native AND can render the Arabic نعم / لا buttons.
  const handleDelete = (id: string) => setConfirmId(id);

  const handleLpShare = useCallback(async (item: VaultItem) => {
    try {
      await shareMedia(item);
    } catch {
      showToast(t('vault.shareUnavailable'), true);
    }
  }, [shareMedia, showToast, t]);

  const performDelete = useCallback(async () => {
    const id = confirmId;
    setConfirmId(null);
    if (!id) return;
    try {
      await removeItem(id);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(t('vault.deleteSuccess'));
    } catch {
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast(t('vault.deleteError'), true);
    }
  }, [confirmId, removeItem, showToast, t]);

  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <View style={[styles.container, { backgroundColor: tc.background }]}>
      <ScreenGlow color="#D4AF37" icon="lock" />
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
        <Text style={styles.headerTitle}>{t('vault.title')}</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="search" size={18} color={tc.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerBtn, { backgroundColor: tc.goldGlass, borderColor: 'rgba(212,175,55,0.30)' }]}
            onPress={() => setShowAdd(true)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="plus" size={18} color={tc.gold} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} removeClippedSubviews={true} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + 20 }]}>

        {/* Hexagonal Category Orbits */}
        <View style={styles.orbSection}>
          <View style={styles.orbCenter}>
            <Svg width={240} height={240} style={StyleSheet.absoluteFill}>
              <Defs>
                <SvgLinearGradient id="orbGrad" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0" stopColor="#D4AF37" stopOpacity="0.3" />
                  <Stop offset="1" stopColor="#8B5CF6" stopOpacity="0.3" />
                </SvgLinearGradient>
              </Defs>
              <Circle cx={120} cy={120} r={100} fill="none" stroke="url(#orbGrad)" strokeWidth={1} strokeDasharray="4 6" />
              <Circle cx={120} cy={120} r={60}  fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
            </Svg>
            <View style={styles.orbCenterHex}>
              <Feather name="shield" size={28} color={tc.gold} />
              <Text style={styles.orbCenterText}>{items.length}</Text>
              <Text style={styles.orbCenterLabel}>items</Text>
            </View>
            {CATEGORIES.map(cat => (
              <CategoryOrb
                key={cat.key}
                config={cat}
                count={categoryCounts[cat.key] ?? 0}
                selected={selectedCat === cat.key}
                onPress={() => setSelectedCat(selectedCat === cat.key ? null : cat.key)}
              />
            ))}
          </View>
        </View>

        {/* Smart Suggestions */}
        {weakCount > 0 && (
          <GlassCard style={styles.suggestCard} variant="gold" padding={14}>
            <View style={styles.suggestRow}>
              <View style={styles.suggestIcon}>
                <Feather name="alert-triangle" size={16} color={tc.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.suggestTitle}>{t('vault.smartSuggestions')}</Text>
                <Text style={styles.suggestSubtitle}>{weakCount} weak password{weakCount > 1 ? 's' : ''} found — tap to review</Text>
              </View>
              <Feather name="chevron-right" size={16} color={tc.gold} />
            </View>
          </GlassCard>
        )}

        {/* Items List */}
        <View style={styles.itemsSection}>
          {selectedCat && (
            <View style={styles.filterHeader}>
              <Text style={styles.filterTitle}>{t(`vault.${selectedCat}`)}</Text>
              <TouchableOpacity onPress={() => setSelectedCat(null)}>
                <Feather name="x" size={16} color={tc.textSecondary} />
              </TouchableOpacity>
            </View>
          )}

          {selectedCat === 'media' ? (
            <MediaSection
              items={displayItems}
              decoyMode={decoyMode}
              busy={busy}
              onAdd={handleAddMedia}
              onOpen={(it) => {
                if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setMediaViewItem(it);
              }}
              onLongPress={(it) => setLpItem(it)}
            />
          ) : displayItems.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="shield-off" size={40} color={tc.textMuted} />
              <Text style={styles.emptyText}>{t('vault.noItems')}</Text>
              <Text style={styles.emptySubtext}>{t('vault.addFirstItem')}</Text>
            </View>
          ) : (
            displayItems.map(item => {
              const cat = getCatConfig(item.category);
              const isMedia = item.category === 'media';
              return (
                <GlassCard key={item.id} style={styles.itemCard} padding={14}>
                  <View style={styles.itemRow}>
                    <View style={[styles.itemIconWrap, { backgroundColor: `${cat.color}20` }]}>
                      <Feather name={cat.icon as any} size={18} color={cat.color} />
                    </View>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemTitle}>{item.title}</Text>
                      {item.subtitle ? <Text style={styles.itemSubtitle}>{item.subtitle}</Text> : null}
                      {item.strength && (
                        <View style={[styles.strengthDot, { backgroundColor: STRENGTH_COLORS[item.strength] }]} />
                      )}
                    </View>
                    <View style={styles.itemActions}>
                      {/* Eye — view secret / media */}
                      <TouchableOpacity
                        style={styles.itemActionBtn}
                        onPress={() => {
                          if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          if (isMedia) setMediaViewItem(item);
                          else setViewItem(item);
                        }}
                      >
                        <Feather name="eye" size={14} color={tc.blue} />
                      </TouchableOpacity>
                      {/* Edit — not for media */}
                      {!isMedia && (
                        <TouchableOpacity
                          style={styles.itemActionBtn}
                          onPress={() => {
                            if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setEditItem(item);
                          }}
                        >
                          <Feather name="edit-2" size={14} color={tc.gold} />
                        </TouchableOpacity>
                      )}
                      {/* Delete */}
                      <TouchableOpacity
                        style={styles.itemActionBtn}
                        onPress={() => handleDelete(item.id)}
                      >
                        <Feather name="trash-2" size={14} color={tc.red} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </GlassCard>
              );
            })
          )}
        </View>
      </ScrollView>

      <AddItemModal visible={showAdd} onClose={() => setShowAdd(false)} />
      <EditItemModal item={editItem} onClose={() => setEditItem(null)} />
      <ViewItemModal item={viewItem} onClose={() => setViewItem(null)} />
      <MediaViewerModal
        item={mediaViewItem}
        onClose={() => setMediaViewItem(null)}
        onDelete={(it) => handleDelete(it.id)}
      />
      <MediaActionSheet
        item={lpItem}
        onClose={() => setLpItem(null)}
        onDelete={(it) => { setLpItem(null); handleDelete(it.id); }}
        onShare={handleLpShare}
      />

      {toast && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toast,
            {
              bottom: tabBarHeight + 24,
              opacity: toastOpacity,
              backgroundColor: toast.error ? 'rgba(60,20,24,0.97)' : 'rgba(16,24,42,0.97)',
              borderColor: toast.error ? 'rgba(239,68,68,0.5)' : 'rgba(212,175,55,0.45)',
            },
          ]}
        >
          <Feather
            name={toast.error ? 'alert-circle' : 'check-circle'}
            size={16}
            color={toast.error ? tc.red : tc.gold}
          />
          <Text style={styles.toastText}>{toast.msg}</Text>
        </Animated.View>
      )}

      <Modal visible={busy} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.busyOverlay}>
          <View style={styles.busyBox}>
            <ActivityIndicator color={tc.gold} size="large" />
            <Text style={styles.busyText}>{t('vault.encrypting')}</Text>
          </View>
        </View>
      </Modal>

      <Modal visible={!!confirmId} transparent animationType="fade" onRequestClose={() => setConfirmId(null)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmIconWrap}>
              <Feather name="trash-2" size={24} color={tc.red} />
            </View>
            <Text style={styles.confirmTitle}>{t('vault.confirmDelete')}</Text>
            <Text style={styles.confirmMsg}>{t('vault.deleteConfirmMsg')}</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setConfirmId(null)}>
                <Text style={styles.modalCancelText}>{t('common.no')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmDeleteBtn} onPress={performDelete}>
                <Text style={styles.confirmDeleteText}>{t('common.yes')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  headerTitle: { fontSize: 22, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold', letterSpacing: 2, lineHeight: 30, includeFontPadding: false },
  headerRight: { flexDirection: 'row', gap: 8 },
  headerBtn: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: tc.glass,
    borderWidth: 1, borderColor: tc.glassBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  scrollContent: { paddingHorizontal: 20, paddingTop: 0 },
  orbSection: { alignItems: 'center', marginVertical: 16 },
  orbCenter: { width: 240, height: 240, alignItems: 'center', justifyContent: 'center' },
  orbCenterHex: { alignItems: 'center', gap: 2 },
  orbCenterText: { fontSize: 22, fontWeight: '700', color: tc.gold, fontFamily: 'Poppins_700Bold', lineHeight: 30, includeFontPadding: false },
  orbCenterLabel: { fontSize: 10, color: tc.textSecondary, fontFamily: 'Poppins_400Regular' },
  orbWrapper: { position: 'absolute', alignItems: 'center', gap: 4 },
  orb: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: tc.glass, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', gap: 1,
  },
  orbCount: { fontSize: 10, fontWeight: '700', fontFamily: 'Poppins_700Bold' },
  orbLabel: { fontSize: 9, fontFamily: 'Poppins_400Regular', textAlign: 'center' },
  suggestCard: { marginBottom: 16 },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  suggestIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: tc.goldGlass, alignItems: 'center', justifyContent: 'center' },
  suggestTitle: { fontSize: 13, fontWeight: '600', color: tc.gold, fontFamily: 'Poppins_600SemiBold' },
  suggestSubtitle: { fontSize: 11, color: tc.textSecondary, fontFamily: 'Poppins_400Regular' },
  itemsSection: { gap: 10 },
  filterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  filterTitle: { fontSize: 14, fontWeight: '600', color: tc.text, fontFamily: 'Poppins_600SemiBold' },
  emptyState: { alignItems: 'center', gap: 8, paddingVertical: 40 },
  emptyText: { fontSize: 16, color: tc.textSecondary, fontFamily: 'Poppins_600SemiBold' },
  emptySubtext: { fontSize: 12, color: tc.textMuted, fontFamily: 'Poppins_400Regular' },
  itemCard: { marginBottom: 2 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemIconWrap: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  itemInfo: { flex: 1, gap: 2 },
  itemTitle: { fontSize: 14, fontWeight: '600', color: tc.text, fontFamily: 'Poppins_600SemiBold' },
  itemSubtitle: { fontSize: 12, color: tc.textSecondary, fontFamily: 'Poppins_400Regular' },
  strengthDot: { width: 6, height: 6, borderRadius: 3, marginTop: 2 },
  itemActions: { flexDirection: 'row', gap: 4 },
  itemActionBtn: {
    width: 30, height: 30, borderRadius: 10,
    backgroundColor: tc.glass,
    alignItems: 'center', justifyContent: 'center',
  },
  /* Add / Edit modals */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#0D1428',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 40,
    borderTopWidth: 1, borderColor: 'rgba(212,175,55,0.20)',
  },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: tc.glass, alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold', marginBottom: 16 },
  catSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 20, borderWidth: 1,
  },
  catChipText: { fontSize: 11, fontFamily: 'Poppins_400Regular' },
  modalInput: {
    backgroundColor: tc.glass,
    borderWidth: 1, borderColor: tc.glassBorder,
    borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    color: tc.text, fontFamily: 'Poppins_400Regular', fontSize: 14,
    marginBottom: 10,
  },
  pwRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  eyeToggle: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: tc.glass,
    borderWidth: 1, borderColor: tc.glassBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  strengthRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  strengthBar: { height: 4, width: 60, borderRadius: 2 },
  strengthLabel: { fontSize: 11, fontFamily: 'Poppins_400Regular', textTransform: 'capitalize' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  modalCancel: {
    flex: 1, paddingVertical: 14, alignItems: 'center',
    backgroundColor: tc.glass, borderRadius: 14,
    borderWidth: 1, borderColor: tc.glassBorder,
  },
  modalCancelText: { color: tc.textSecondary, fontFamily: 'Poppins_600SemiBold', fontSize: 14 },
  modalConfirm: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  modalConfirmGrad: { paddingVertical: 14, alignItems: 'center' },
  modalConfirmText: { color: '#0A0F1E', fontWeight: '700', fontFamily: 'Poppins_700Bold', fontSize: 14 },
  editCatIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  /* Delete confirmation modal (cross-platform; Alert.alert buttons don't work on web) */
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  confirmCard: {
    width: '100%', maxWidth: 380,
    backgroundColor: '#0D1428', borderRadius: 24, padding: 26,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.28)', alignItems: 'center',
  },
  confirmIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(239,68,68,0.12)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  confirmTitle: { fontSize: 18, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 8 },
  confirmMsg: { fontSize: 14, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 21, marginBottom: 22 },
  confirmDeleteBtn: { flex: 1, paddingVertical: 14, alignItems: 'center', backgroundColor: tc.red, borderRadius: 14 },
  confirmDeleteText: { color: '#fff', fontWeight: '700', fontFamily: 'Poppins_700Bold', fontSize: 14 },
  /* View secret modal */
  viewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  viewSheet: {
    width: '100%',
    backgroundColor: '#0D1428',
    borderRadius: 24,
    padding: 28,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.25)',
    alignItems: 'center',
    gap: 10,
  },
  viewCatIcon: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  viewTitle: { fontSize: 18, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold', textAlign: 'center' },
  viewSubtitle: { fontSize: 13, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', textAlign: 'center' },
  strengthPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1 },
  strengthDot2: { width: 7, height: 7, borderRadius: 4 },
  strengthPillText: { fontSize: 11, fontFamily: 'Poppins_400Regular', textTransform: 'capitalize' },
  secretBox: {
    width: '100%',
    backgroundColor: tc.glass,
    borderRadius: 14, borderWidth: 1,
    borderColor: tc.glassBorder,
    padding: 14, marginTop: 4,
  },
  secretLabel: { fontSize: 11, color: tc.textMuted, fontFamily: 'Poppins_400Regular', marginBottom: 6 },
  secretRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  secretValue: { flex: 1, fontSize: 15, color: tc.text, fontFamily: 'Poppins_400Regular', letterSpacing: 1 },
  secretEye: { padding: 4 },
  viewClose: { width: '100%', borderRadius: 14, overflow: 'hidden', marginTop: 8 },
  viewCloseGrad: { paddingVertical: 14, alignItems: 'center' },
  viewCloseText: { color: '#0A0F1E', fontWeight: '700', fontFamily: 'Poppins_700Bold', fontSize: 15 },
  /* Media gallery */
  mediaAddRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  mediaAddBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: tc.purpleGlass,
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.30)',
  },
  mediaAddText: { fontSize: 11, color: tc.purpleLight, fontFamily: 'Poppins_600SemiBold' },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  mediaCard: {
    width: '31.5%',
    aspectRatio: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: tc.glass,
    borderWidth: 1,
    borderColor: tc.glassBorder,
  },
  mediaThumbImg: { width: '100%', height: '100%' },
  mediaThumbPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tc.backgroundTertiary,
  },
  mediaPlayBadge: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 34,
    height: 34,
    marginTop: -17,
    marginLeft: -17,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  mediaCardLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: 'rgba(10,15,30,0.72)',
  },
  mediaCardText: { fontSize: 10, color: tc.text, fontFamily: 'Poppins_400Regular' },
  /* Media viewer */
  viewerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', paddingHorizontal: 16 },
  viewerSheet: {
    backgroundColor: '#0D1428',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.25)',
    overflow: 'hidden',
  },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: tc.glassBorder,
  },
  viewerTitle: { flex: 1, fontSize: 15, color: tc.text, fontFamily: 'Poppins_600SemiBold' },
  viewerCloseBtn: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: tc.glass,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 10,
  },
  viewerBody: {
    minHeight: 260,
    maxHeight: 440,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#05080F',
  },
  viewerImage: { width: '100%', height: 440 },
  viewerVideo: { width: '100%', height: 300, backgroundColor: '#000000' },
  viewerFallback: { alignItems: 'center', gap: 10, padding: 30 },
  viewerFallbackText: { fontSize: 13, color: tc.textSecondary, fontFamily: 'Poppins_400Regular', textAlign: 'center' },
  viewerFileIcon: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: 'rgba(249,115,22,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  viewerFileName: { fontSize: 15, color: tc.text, fontFamily: 'Poppins_600SemiBold', textAlign: 'center' },
  viewerFileMeta: { fontSize: 12, color: tc.textSecondary, fontFamily: 'Poppins_400Regular' },
  viewerFileHint: { fontSize: 11, color: tc.textMuted, fontFamily: 'Poppins_400Regular', textAlign: 'center', marginTop: 4 },
  viewerActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: tc.glassBorder,
  },
  viewerActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
  },
  viewerActionText: { fontSize: 12, fontFamily: 'Poppins_600SemiBold' },
  /* Busy overlay */
  busyOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  busyBox: {
    backgroundColor: '#0D1428',
    borderRadius: 20,
    paddingVertical: 26,
    paddingHorizontal: 34,
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.25)',
  },
  busyText: { fontSize: 13, color: tc.textSecondary, fontFamily: 'Poppins_600SemiBold' },
  toast: {
    position: 'absolute',
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  toastText: { flexShrink: 1, fontSize: 13, color: '#fff', fontFamily: 'Poppins_600SemiBold', textAlign: 'center' },
  /* Long-press action sheet */
  actionOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  actionSheet: {
    backgroundColor: '#0D1428',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderColor: 'rgba(139,92,246,0.25)',
  },
  actionHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center', marginTop: 12, marginBottom: 16,
  },
  actionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingBottom: 14,
  },
  actionKindIcon: {
    width: 44, height: 44, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  actionItemName: {
    flex: 1, fontSize: 15, fontWeight: '600',
    color: tc.text, fontFamily: 'Poppins_600SemiBold',
  },
  actionDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginBottom: 6 },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 16, paddingHorizontal: 20,
  },
  actionIconWrap: {
    width: 42, height: 42, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 15, color: tc.text,
    fontFamily: 'Poppins_600SemiBold',
  },
  actionCancel: {
    marginHorizontal: 16, marginTop: 6,
    paddingVertical: 15,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  actionCancelText: {
    fontSize: 15, color: tc.textSecondary,
    fontFamily: 'Poppins_600SemiBold',
  },
});

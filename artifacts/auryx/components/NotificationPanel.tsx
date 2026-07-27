import React, { useCallback, useEffect, useMemo } from 'react';
import {
  FlatList,
  ListRenderItemInfo,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme, ThemeColors } from '@/contexts/ThemeContext';
import { AppNotification, useNotifications } from '@/contexts/NotificationContext';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Date grouping helper ─────────────────────────────────────────────────────

function getDateLabel(ts: number, t: (key: string) => string): string {
  const now = new Date();
  const d = new Date(ts);
  const diff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return t('notifications.today');
  if (diff === 1) return t('notifications.yesterday');
  if (diff < 7) return t('notifications.thisWeek');
  if (diff < 30) return t('notifications.thisMonth');
  return t('notifications.older');
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

// ─── Item types ───────────────────────────────────────────────────────────────

type RowItem =
  | { kind: 'header'; label: string }
  | { kind: 'notif'; data: AppNotification };

// ─── Single notification row ──────────────────────────────────────────────────

const NotifRow = React.memo(function NotifRow({ item }: { item: AppNotification }) {
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const isUnread = !item.read;
  return (
    <View style={[styles.row, !isUnread && styles.rowRead]}>
      {/* Left icon badge */}
      <View style={[styles.iconWrap, { backgroundColor: `${item.iconColor}1A` }]}>
        <Feather name={item.icon as any} size={16} color={item.iconColor} />
      </View>

      {/* Text area */}
      <View style={styles.rowText}>
        <View style={styles.rowTitleRow}>
          <Text style={[styles.rowTitle, !isUnread && styles.rowTitleRead]} numberOfLines={1}>
            {item.title}
          </Text>
          {isUnread && <View style={styles.unreadDot} />}
        </View>
        <Text style={styles.rowBody} numberOfLines={2}>
          {item.body}
        </Text>
        <Text style={styles.rowTime}>{formatTime(item.createdAt)}</Text>
      </View>
    </View>
  );
});

// ─── Section header ───────────────────────────────────────────────────────────

const SectionHeader = React.memo(function SectionHeader({ label }: { label: string }) {
  const { colors: tc } = useTheme();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
});

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  const { colors: tc } = useTheme();
  const { t } = useLanguage();
  return (
    <View style={staticStyles.emptyWrap}>
      <Feather name="bell-off" size={48} color={tc.textMuted} />
      <Text style={[staticStyles.emptyTitle, { color: tc.textSecondary }]}>{t('notifications.empty')}</Text>
      <Text style={[staticStyles.emptyBody, { color: tc.textMuted }]}>{t('notifications.emptySub')}</Text>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function NotificationPanel({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { notifications, unreadCount, markAllRead } = useNotifications();
  const { colors: tc } = useTheme();
  const { t } = useLanguage();
  const styles = useMemo(() => makeStyles(tc), [tc]);

  // Mark all read when the panel opens
  useEffect(() => {
    if (visible && unreadCount > 0) {
      markAllRead();
    }
  }, [visible]);

  const handleClose = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    onClose();
  }, [onClose]);

  // Build flat list rows: inject section headers when date group changes
  const rows = useMemo((): RowItem[] => {
    const result: RowItem[] = [];
    let lastLabel = '';
    for (const n of notifications) {
      const label = getDateLabel(n.createdAt, t);
      if (label !== lastLabel) {
        result.push({ kind: 'header', label });
        lastLabel = label;
      }
      result.push({ kind: 'notif', data: n });
    }
    return result;
  }, [notifications, t]);

  const renderItem = useCallback(({ item }: ListRenderItemInfo<RowItem>) => {
    if (item.kind === 'header') return <SectionHeader label={item.label} />;
    return <NotifRow item={item.data} />;
  }, []);

  const keyExtractor = useCallback((item: RowItem, index: number) => {
    if (item.kind === 'header') return `header:${item.label}:${index}`;
    return item.data.id;
  }, []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === 'web' ? 20 : 8) }]}>
        {/* Header bar */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>{t('notifications.title')}</Text>
            {unreadCount > 0 && (
              <View style={styles.headerBadge}>
                <Text style={styles.headerBadgeText}>{unreadCount}</Text>
              </View>
            )}
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={handleClose} activeOpacity={0.7}>
            <Feather name="x" size={20} color={tc.text} />
          </TouchableOpacity>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Notification list */}
        <FlatList
          data={rows}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 20 },
          ]}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={5}
          ListEmptyComponent={EmptyState}
        />
      </View>
    </Modal>
  );
}

// ─── Static (layout-only) styles ─────────────────────────────────────────────

const staticStyles = StyleSheet.create({
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingTop: 80,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'Poppins_600SemiBold',
  },
  emptyBody: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 20,
  },
});

// ─── Themed styles factory ────────────────────────────────────────────────────

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tc.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: tc.text,
    fontFamily: 'Poppins_700Bold',
  },
  headerBadge: {
    backgroundColor: tc.red,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  headerBadgeText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '700',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: tc.glass,
    borderWidth: 1,
    borderColor: tc.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: tc.separator,
    marginHorizontal: 20,
  },
  listContent: {
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: tc.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: 'Poppins_600SemiBold',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 2,
    backgroundColor: tc.glass,
    borderWidth: 1,
    borderColor: tc.glassBorder,
    marginVertical: 2,
  },
  rowRead: {
    opacity: 0.55,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: tc.text,
    fontFamily: 'Poppins_600SemiBold',
    flex: 1,
  },
  rowTitleRead: {
    color: tc.textSecondary,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: tc.gold,
    flexShrink: 0,
  },
  rowBody: {
    fontSize: 12,
    color: tc.textSecondary,
    fontFamily: 'Poppins_400Regular',
    lineHeight: 18,
  },
  rowTime: {
    fontSize: 10,
    color: tc.textMuted,
    fontFamily: 'Poppins_400Regular',
    marginTop: 2,
  },
});

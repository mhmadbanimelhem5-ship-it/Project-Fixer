import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useVault, type AuditEntry } from '@/contexts/VaultContext';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotifType = 'security' | 'guardian' | 'vault' | 'legacy' | 'system';

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  type: NotifType;
  icon: string;
  iconColor: string;
  createdAt: number;
  read: boolean;
}

interface NotificationContextType {
  /** All notifications, newest first */
  notifications: AppNotification[];
  /** Number of unread notifications */
  unreadCount: number;
  /** Mark every current notification as read */
  markAllRead: () => void;
  /**
   * Add a system/push notification (from server or local trigger).
   * Safe to call from anywhere — deduplicates by id.
   */
  addSystemNotification: (n: Omit<AppNotification, 'createdAt' | 'read'>) => void;
}

// ─── Storage helpers (mirrors VaultContext pattern) ───────────────────────────

const READ_UNTIL_KEY = 'auryx:notif:readUntil';
const SYSTEM_NOTIFS_KEY = 'auryx:notif:system';

async function secureGet(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return localStorage.getItem(key);
    return await SecureStore.getItemAsync(key);
  } catch { return null; }
}

async function secureSet(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') { localStorage.setItem(key, value); return; }
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    });
  } catch {}
}

// ─── Audit → Notification mapping ────────────────────────────────────────────

type TFunc = (key: string, params?: Record<string, string | number>) => string;

function mapAuditEntry(entry: AuditEntry, t: TFunc): AppNotification {
  const a = entry.action;
  let title = t('notifications.notif_vault_activity');
  let body = a;
  let icon = 'activity';
  let iconColor = '#8B5CF6';
  let type: NotifType = 'vault';

  if (a.startsWith('Added guardian:')) {
    title = t('notifications.notif_guardian_added');
    body = a.replace('Added guardian:', '').trim();
    icon = 'user-plus';
    iconColor = '#3B82F6';
    type = 'guardian';
  } else if (a.startsWith('Removed guardian:')) {
    title = t('notifications.notif_guardian_removed');
    body = a.replace('Removed guardian:', '').trim();
    icon = 'user-minus';
    iconColor = '#EF4444';
    type = 'guardian';
  } else if (a.startsWith('Guardian accepted:')) {
    title = t('notifications.notif_guardian_accepted');
    body = a.replace('Guardian accepted:', '').trim();
    icon = 'user-check';
    iconColor = '#22C55E';
    type = 'guardian';
  } else if (a.startsWith('Guardian rejected:')) {
    title = t('notifications.notif_guardian_rejected');
    body = a.replace('Guardian rejected:', '').trim();
    icon = 'user-x';
    iconColor = '#EF4444';
    type = 'guardian';
  } else if (a.startsWith('Guardian deactivated:')) {
    title = t('notifications.notif_guardian_deactivated');
    body = a.replace('Guardian deactivated:', '').trim();
    icon = 'user-minus';
    iconColor = '#F97316';
    type = 'guardian';
  } else if (a.startsWith('Updated item:')) {
    title = t('notifications.notif_item_updated');
    body = a.replace('Updated item:', '').trim();
    icon = 'edit-3';
    iconColor = '#3B82F6';
    type = 'vault';
  } else if (a.startsWith('Beneficiary set:')) {
    title = t('notifications.notif_beneficiary_set');
    body = a.replace('Beneficiary set:', '').trim();
    icon = 'heart';
    iconColor = '#D4AF37';
    type = 'legacy';
  } else if (a === 'Legacy mode enabled') {
    title = t('notifications.notif_legacy_enabled');
    body = t('notifications.notif_legacy_enabled_body');
    icon = 'shield';
    iconColor = '#D4AF37';
    type = 'legacy';
  } else if (a === 'Legacy mode disabled') {
    title = t('notifications.notif_legacy_disabled');
    body = t('notifications.notif_legacy_disabled_body');
    icon = 'shield-off';
    iconColor = '#6B7280';
    type = 'legacy';
  } else if (a.startsWith('Absence timer set:')) {
    title = t('notifications.notif_absence_timer');
    body = a.replace('Absence timer set:', '').trim();
    icon = 'clock';
    iconColor = '#8B5CF6';
    type = 'legacy';
  } else if (a.startsWith('Added media:')) {
    title = t('notifications.notif_media_added');
    body = a.replace('Added media:', '').trim();
    icon = 'image';
    iconColor = '#14B8A6';
    type = 'vault';
  } else if (a.startsWith('Added item:')) {
    title = t('notifications.notif_item_added');
    body = a.replace('Added item:', '').trim();
    icon = 'plus-circle';
    iconColor = '#22C55E';
    type = 'vault';
  } else if (a.startsWith('Removed item:')) {
    title = t('notifications.notif_item_removed');
    body = a.replace('Removed item:', '').trim();
    icon = 'trash-2';
    iconColor = '#EF4444';
    type = 'vault';
  } else if (a.toLowerCase().includes('legacy') || a.toLowerCase().includes('seal') || a.toLowerCase().includes('emergency')) {
    title = t('notifications.notif_legacy_activity');
    body = a;
    icon = 'clock';
    iconColor = '#D4AF37';
    type = 'legacy';
  }

  return {
    id: `audit:${entry.id}`,
    title,
    body,
    type,
    icon,
    iconColor,
    createdAt: entry.timestamp,
    read: false, // will be overridden by consumer based on readUntil
  };
}

// ─── Context ──────────────────────────────────────────────────────────────────

const NotificationContext = createContext<NotificationContextType>({
  notifications: [],
  unreadCount: 0,
  markAllRead: () => {},
  addSystemNotification: () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { auditLog, getWeakItemsCount, items } = useVault();
  const { t } = useLanguage();

  // Persisted: timestamp up to which all notifications are considered read.
  const [readUntil, setReadUntil] = useState<number>(0);
  // System (server-push) notifications stored independently.
  const [systemNotifs, setSystemNotifs] = useState<AppNotification[]>([]);
  const loadedRef = useRef(false);

  // Load persisted state once on mount
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      const [ru, sn] = await Promise.all([
        secureGet(READ_UNTIL_KEY),
        secureGet(SYSTEM_NOTIFS_KEY),
      ]);
      if (ru) setReadUntil(Number(ru));
      if (sn) {
        try { setSystemNotifs(JSON.parse(sn)); } catch {}
      }
    })();
  }, []);

  // ── Derive security alert notification ──────────────────────────────────────
  // Re-computed only when weak item count changes, not on every render.
  const weakCount = useMemo(() => getWeakItemsCount(), [getWeakItemsCount, items]);

  // Stable timestamp for the security notification: only advances when weakCount
  // crosses from 0 → >0, so changing weakCount (e.g. 3→2) doesn't bump the
  // timestamp past readUntil and falsely re-show the badge as unread.
  const weakNotifCreatedAtRef = useRef<number>(0);
  useEffect(() => {
    if (weakCount > 0 && weakNotifCreatedAtRef.current === 0) {
      weakNotifCreatedAtRef.current = Date.now();
    } else if (weakCount === 0) {
      weakNotifCreatedAtRef.current = 0;
    }
  }, [weakCount]);

  const securityNotif: AppNotification | null = useMemo(() => {
    if (weakCount === 0) return null;
    const titleKey = weakCount === 1
      ? 'notifications.notif_weak_items_one'
      : 'notifications.notif_weak_items_other';
    return {
      id: 'security:weak-items',
      title: t(titleKey, { count: weakCount }),
      body: t('notifications.notif_weak_items_body'),
      type: 'security',
      icon: 'alert-triangle',
      iconColor: '#F97316',
      createdAt: weakNotifCreatedAtRef.current || Date.now(),
      read: false,
    };
  }, [weakCount, t]);

  // ── Convert audit log → notifications ───────────────────────────────────────
  // Sorted newest-first, then merged with security + system.
  const allNotifications = useMemo((): AppNotification[] => {
    const auditNotifs = [...auditLog]
      .sort((a, b) => b.timestamp - a.timestamp)
      .map(entry => ({
        ...mapAuditEntry(entry, t),
        read: entry.timestamp <= readUntil,
      }));

    const sysWithRead = [...systemNotifs]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(n => ({ ...n, read: n.createdAt <= readUntil }));

    const sec = securityNotif
      ? [{ ...securityNotif, read: securityNotif.createdAt <= readUntil }]
      : [];

    // Merge: security first (pinned), then interleave system + audit by date
    const combined = [...sysWithRead, ...auditNotifs];
    combined.sort((a, b) => b.createdAt - a.createdAt);

    return [...sec, ...combined];
  }, [auditLog, systemNotifs, securityNotif, readUntil, t]);

  const unreadCount = useMemo(
    () => allNotifications.filter(n => !n.read).length,
    [allNotifications],
  );

  const markAllRead = useCallback(() => {
    const now = Date.now();
    setReadUntil(now);
    secureSet(READ_UNTIL_KEY, String(now));
  }, []);

  const addSystemNotification = useCallback((
    n: Omit<AppNotification, 'createdAt' | 'read'>,
  ) => {
    setSystemNotifs(prev => {
      // Deduplicate by id
      if (prev.some(x => x.id === n.id)) return prev;
      const next = [{ ...n, createdAt: Date.now(), read: false }, ...prev];
      secureSet(SYSTEM_NOTIFS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <NotificationContext.Provider value={{
      notifications: allNotifications,
      unreadCount,
      markAllRead,
      addSystemNotification,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}

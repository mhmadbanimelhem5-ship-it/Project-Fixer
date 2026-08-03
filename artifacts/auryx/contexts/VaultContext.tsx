import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { perfEnd, perfMark, perfStart } from '@/utils/perfLog';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CryptoJS from 'crypto-js';
import {
  clearMediaSession,
  clearMediaTemp,
  deleteEncryptedMedia,
  exportEncryptedMedia,
  getImagePreview,
  MediaKind,
  MediaScope,
  PickedMedia,
  prepareTempFile,
  saveEncryptedMedia,
  shareMediaSecurely,
} from '@/utils/mediaStorage';
import { clearKeyCache, generateAndStoreKeyPair, getOrCreatePublicKey, hasKeyPair } from '@/utils/keyManager';
import { registerPublicKey } from '@/utils/vaultTransferApi';
import { sealVault, approveGuardianAccess, type SealResult } from '@/utils/legacyTransfer';

export type VaultCategory = 'logins' | 'media' | 'banking' | 'notes' | 'documents' | 'crypto';

export interface VaultItem {
  id: string;
  category: VaultCategory;
  title: string;
  subtitle?: string;
  encryptedData: string;
  createdAt: number;
  updatedAt: number;
  strength?: 'weak' | 'fair' | 'strong' | 'very_strong';
  tags?: string[];
  // Media-only fields (category === 'media')
  mediaKind?: MediaKind;
  mediaRef?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
}

export interface Guardian {
  id: string;
  name: string;
  email: string;
  relationship: string;
  status: 'active' | 'pending' | 'inactive' | 'rejected';
  avatarColor: string;
  addedAt: number;
  inviteToken?: string;
}

export interface Beneficiary {
  name: string;
  email: string;
  phone?: string;
  inviteStatus?: 'pending' | 'accepted' | 'rejected';
  inviteToken?: string;
}

export type AbsenceDays = 7 | 14 | 30 | 60 | 90;

export interface LegacySettings {
  ownerName?: string;
  ownerEmail?: string;
  beneficiary?: Beneficiary;
  absenceDays: AbsenceDays;
  mOfN: { m: number; n: number };
  enabled: boolean;
  userRole: 'owner' | 'guardian' | 'beneficiary';
  lastActiveAt?: number;
  emergencyActivatedAt?: number;
  /** When userRole==='beneficiary': the vault owner's display name */
  beneficiaryOwnerName?: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  timestamp: number;
  blockHash: string;
  prevHash: string;
  source?: 'app' | 'link';
}

interface VaultContextType {
  items: VaultItem[];
  guardians: Guardian[];
  legacy: LegacySettings;
  auditLog: AuditEntry[];
  decoyMode: boolean;
  mediaSessionVersion: number;
  addItem: (item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>) => void;
  removeItem: (id: string) => Promise<void>;
  updateItem: (id: string, updates: Partial<VaultItem>) => void;
  getItemsByCategory: (cat: VaultCategory) => VaultItem[];
  addMediaItem: (media: PickedMedia, title: string) => Promise<void>;
  getMediaPreview: (item: VaultItem) => Promise<string>;
  getMediaTempFile: (item: VaultItem) => Promise<string>;
  exportMedia: (item: VaultItem) => Promise<void>;
  shareMedia: (item: VaultItem) => Promise<void>;
  clearMediaSession: () => Promise<void>;
  encryptData: (data: string) => string;
  decryptData: (encrypted: string) => string;
  addGuardian: (g: Omit<Guardian, 'id' | 'addedAt' | 'avatarColor'>) => Guardian;
  updateGuardian: (id: string, updates: Partial<Guardian>) => void;
  removeGuardian: (id: string) => void;
  updateLegacy: (settings: Partial<LegacySettings>) => void;
  addAuditEntry: (action: string, source?: 'app' | 'link') => void;
  isVaultReady: boolean;
  loadVault: (key: string) => Promise<void>;
  loadDecoyVault: (key: string) => Promise<void>;
  lockVaultSession: () => Promise<void>;
  saveVault: () => Promise<void>;
  getWeakItemsCount: () => number;
  /** Seal this vault for legacy transfer (Layer 2 RSA + Layer 3 Shamir). */
  sealVaultForLegacy: () => Promise<SealResult>;
  /** Guardian: decrypt own share and submit it to the server. */
  approveGuardianLegacy: (ownerEmail: string) => Promise<{ success: boolean; error?: string }>;
  /** True once the device's RSA key pair is generated and registered. */
  keyReady: boolean;
  /** True if RSA key generation failed (e.g. timeout or crypto error). */
  keyError: boolean;
  /** Human-readable reason for the last key generation failure, or ''. */
  keyErrorMsg: string;
  /** True while RSA key generation is actively running (may take 1-7 min on first launch). */
  isKeyGenerating: boolean;
  /** Retry RSA key generation + server registration. Returns true on success. */
  retryKeyGeneration: (ownerEmail?: string) => Promise<boolean>;
  /** Current vault loading phase description (Arabic), empty when idle. */
  vaultLoadPhase: string;
  /** 0–100 progress of the current RSA key generation. 100 when done. */
  keyGenProgress: number;
  /** Short Arabic label describing the current key-generation step. */
  keyGenPhase: string;
}

const VAULT_STORAGE_KEY = 'auryx_vault_data';
const DECOY_VAULT_STORAGE_KEY = 'auryx_decoy_vault_data';
const GUARDIANS_KEY = 'auryx_guardians';
const LEGACY_KEY = 'auryx_legacy';
const AUDIT_LOG_KEY = 'auryx:audit:log';

const AUDIT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7-day rolling retention

const DEFAULT_LEGACY: LegacySettings = { absenceDays: 30, mOfN: { m: 2, n: 3 }, enabled: false, userRole: 'owner' };

const VaultContext = createContext<VaultContextType>({} as VaultContextType);

const GUARDIAN_COLORS = ['#8B5CF6', '#3B82F6', '#D4AF37', '#EF4444', '#14B8A6', '#F97316'];

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

// ── AsyncStorage helpers for audit log ────────────────────────────────────────
// Audit log is non-sensitive (action strings only) and can grow large.
// SecureStore on iOS is capped at 2 KB per value — silent write failures once
// the log exceeds that size. AsyncStorage has no such limit.
async function asyncGet(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return localStorage.getItem(key);
    return await AsyncStorage.getItem(key);
  } catch { return null; }
}

async function asyncSet(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') { localStorage.setItem(key, value); return; }
    await AsyncStorage.setItem(key, value);
  } catch {}
}

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function computeBlockHash(data: string, prevHash: string): string {
  return CryptoJS.SHA256(prevHash + data + Date.now()).toString();
}

const DEMO_ITEMS: VaultItem[] = [];

const DEMO_GUARDIANS: Guardian[] = [];

const DECOY_ITEMS: VaultItem[] = [];

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [legacy, setLegacy] = useState<LegacySettings>(DEFAULT_LEGACY);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [vaultKey, setVaultKeyState] = useState<string | null>(null);
  const [decoyMode, setDecoyModeState] = useState(false);
  // Transition guards: autosave may ONLY fire when a load has fully finished
  // (isVaultReady) AND the persisted-to store matches the active mode
  // (loadedMode). This makes it impossible for real metadata to be written into
  // decoy storage (or vice-versa) during the reset→load window.
  const [isVaultReady, setIsVaultReady] = useState(false);
  const [vaultLoadPhase, setVaultLoadPhase] = useState('');
  const [loadedMode, setLoadedMode] = useState<'none' | 'real' | 'decoy'>('none');
  // Bumped on every media-session wipe (lock / logout / decoy). UI components
  // watch this to drop decrypted media held in React state at the boundary.
  const [mediaSessionVersion, setMediaSessionVersion] = useState(0);
  const [keyReady, setKeyReady] = useState(false);
  const [keyError, setKeyError] = useState(false);
  const [keyErrorMsg, setKeyErrorMsg] = useState('');
  const [isKeyGenerating, setIsKeyGenerating] = useState(false);
  const [keyGenProgress, setKeyGenProgress] = useState(0);
  const [keyGenPhase, setKeyGenPhase] = useState('');
  // Monotonic generation for vault transitions. Bumped at the START of every
  // load/lock; each async load captures its generation and refuses to commit
  // its final state if a newer transition has since begun. Without this, a
  // slow in-flight real load could resolve AFTER a decoy load and clobber the
  // decoy session with real data (or vice-versa) — a fatal isolation break.
  const loadGenerationRef = useRef(0);
  // Guards against double RSA init between loadVault and the post-onboarding
  // useEffect — both paths set this to true before launching the async work.
  // Reset to false in resetSession so a re-login can re-initialise keys.
  const keyInitScheduledRef = useRef(false);
  // Live mirror of `items` for reads inside async callbacks that may outlive the
  // render which created them — e.g. a delete confirmed from a native Alert after
  // an auto-lock or real↔decoy switch. Reading this ref (not a captured `items`
  // closure) makes delete session-bound: if the session changed, the old id
  // simply isn't in the current items, so the delete is a safe no-op.
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  // Tear the session down to a clean, NOT-ready state. Every load path calls
  // this FIRST so no slice, key, or decrypted media from a previous session can
  // survive into the next one — this is the core of real/decoy isolation.
  const resetSession = useCallback(async () => {
    setIsVaultReady(false);
    setLoadedMode('none');
    setVaultKeyState(null);
    setItems([]);
    setGuardians([]);
    setLegacy(DEFAULT_LEGACY);
    setAuditLog([]);
    setKeyReady(false);
    setKeyError(false);
    setKeyErrorMsg('');
    setIsKeyGenerating(false);
    keyInitScheduledRef.current = false;
    // Wipe decrypted plaintext temp files + preview cache.
    // Promise.race with a 2-second timeout: on Android, FileSystem ops can stall
    // indefinitely on first launch (no cache dir yet). We must never let a hung
    // clearMediaSession block loadVault from eventually setting isVaultReady=true.
    await Promise.race([
      clearMediaSession(),
      new Promise<void>(resolve => setTimeout(resolve, 2000)),
    ]);
    setMediaSessionVersion(v => v + 1);
  }, []);

  const encryptData = useCallback((data: string): string => {
    if (!vaultKey) return data;
    return CryptoJS.AES.encrypt(data, vaultKey).toString();
  }, [vaultKey]);

  const decryptData = useCallback((encrypted: string): string => {
    if (!vaultKey || !encrypted) return '';
    try {
      const bytes = CryptoJS.AES.decrypt(encrypted, vaultKey);
      return bytes.toString(CryptoJS.enc.Utf8);
    } catch { return ''; }
  }, [vaultKey]);

  const addAuditEntry = useCallback((action: string, source?: 'app' | 'link') => {
    setAuditLog(prev => {
      const prevHash = prev.length > 0 ? prev[prev.length - 1].blockHash : '0';
      const blockHash = computeBlockHash(action, prevHash);
      const next = [...prev, { id: generateId(), action, timestamp: Date.now(), blockHash, prevHash, source: source ?? 'app' }];
      // Save immediately so entries survive even if the app is killed before
      // the 300 ms debounce fires. AsyncStorage has no 2 KB size cap (unlike
      // SecureStore on iOS), so the log can grow beyond 50+ entries safely.
      asyncSet(AUDIT_LOG_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Load the REAL vault. Resets first, then flips ready/loadedMode/key together
  // at the end so autosave only sees a fully-consistent real session. The
  // generation guard aborts the commit if a newer transition started meanwhile.
  const loadVault = useCallback(async (key: string) => {
    perfStart('loadVault:total');
    const gen = ++loadGenerationRef.current;
    setVaultLoadPhase('جارٍ تهيئة الجلسة');
    try { await resetSession(); } catch { /* clearMediaSession failure — safe to continue with fresh defaults */ }
    if (gen !== loadGenerationRef.current) return; // superseded during reset

    let nextItems = DEMO_ITEMS;
    let nextGuardians = DEMO_GUARDIANS;
    let nextLegacy = DEFAULT_LEGACY;

    setVaultLoadPhase('جارٍ فك تشفير البيانات');
    perfStart('loadVault:secureReads');
    try {
      const stored = await secureGet(VAULT_STORAGE_KEY);
      if (stored) {
        const decrypted = CryptoJS.AES.decrypt(stored, key).toString(CryptoJS.enc.Utf8);
        if (decrypted) nextItems = JSON.parse(decrypted);
      }
      const storedGuardians = await secureGet(GUARDIANS_KEY);
      if (storedGuardians) nextGuardians = JSON.parse(storedGuardians);
      const storedLegacy = await secureGet(LEGACY_KEY);
      if (storedLegacy) nextLegacy = JSON.parse(storedLegacy);
    } catch {
      nextItems = DEMO_ITEMS;
      nextGuardians = DEMO_GUARDIANS;
      nextLegacy = DEFAULT_LEGACY;
    }
    perfEnd('loadVault:secureReads');

    // Load and archive audit log (7-day rolling retention).
    // Primary source: AsyncStorage (no iOS 2 KB limit).
    // Migration: on first run after upgrade, copy any existing SecureStore
    // entries to AsyncStorage so no historical entries are lost.
    setVaultLoadPhase('جارٍ تحميل سجل الأمان');
    perfStart('loadVault:auditLog');
    let nextAuditLog: AuditEntry[] = [];
    try {
      let storedAudit = await asyncGet(AUDIT_LOG_KEY);
      if (!storedAudit) {
        // One-time migration from old SecureStore location
        const legacy = await secureGet(AUDIT_LOG_KEY);
        if (legacy) {
          storedAudit = legacy;
          asyncSet(AUDIT_LOG_KEY, legacy); // persist to new location
          SecureStore.deleteItemAsync(AUDIT_LOG_KEY).catch(() => {}); // clean up old
        }
      }
      if (storedAudit) {
        const parsed: AuditEntry[] = JSON.parse(storedAudit);
        const cutoff = Date.now() - AUDIT_TTL_MS;
        nextAuditLog = parsed.filter(e => e.timestamp > cutoff);
      }
    } catch {}
    perfEnd('loadVault:auditLog');

    if (gen !== loadGenerationRef.current) return; // superseded during reads

    // ── Dead-man's switch: reset the absence timer on every successful unlock ──
    // lock.tsx navigates to /(tabs) BEFORE loadVault resolves, so any reset
    // attempted from index.tsx's useEffect fires against the DEFAULT legacy
    // (enabled=false) and does nothing.  Resetting here is the only reliable
    // place — it is atomic with the setLegacy call that follows.
    if (nextLegacy.enabled && nextLegacy.beneficiary) {
      nextLegacy = { ...nextLegacy, lastActiveAt: Date.now() };
    }

    setVaultLoadPhase('جارٍ تجهيز الخزنة');
    setDecoyModeState(false);
    setItems(nextItems);
    setGuardians(nextGuardians);
    setLegacy(nextLegacy);
    setAuditLog(nextAuditLog);
    setVaultKeyState(key);
    setLoadedMode('real');
    setIsVaultReady(true);
    perfEnd('loadVault:total');
    setVaultLoadPhase('');

    // Warm up the API server in the background so email/notification endpoints
    // are ready by the time the user interacts with guardians or beneficiary.
    // Fire-and-forget: a failure here has no user-visible effect.
    setTimeout(() => {
      const domain = (process.env.EXPO_PUBLIC_DOMAIN as string | undefined) ?? '';
      if (domain) {
        fetch(`https://${domain}/api/healthz`, { method: 'GET' }).catch(() => {});
      }
    }, 800);

    // Initialize RSA key pair (idempotent) and register public key on server.
    // SKIP on first launch (ownerName not yet set): node-forge pure-JS RSA-2048
    // blocks the JS thread for 30–120 s on real ARM devices with no Web Workers.
    // That freeze prevents the onboarding screen from responding to any button
    // press.  The post-onboarding useEffect (below) starts RSA the moment the
    // user sets their name and navigates away from onboarding.
    // For returning users ownerName IS set, so we start immediately (600 ms
    // deferral lets React flush navigation before any CPU-intensive work begins).
    // Note: InteractionManager.runAfterInteractions was tested here but can
    // deadlock when looping Animated animations are active — setTimeout is safer.
    if (nextLegacy.ownerName) {
      keyInitScheduledRef.current = true;
      setTimeout(async () => {
        perfStart('keyInit:total');
        const keyExists = await hasKeyPair();

        if (keyExists) {
          // Fast path: key already stored — load silently, no overlay needed.
          // SecureStore read typically finishes in <50 ms.
          perfMark('keyInit:fast-path', 'loading existing key from SecureStore');
          try {
            perfStart('keyInit:fastPath');
            const pubJwk = await getOrCreatePublicKey();
            perfEnd('keyInit:fastPath');
            const email = nextLegacy.ownerEmail;
            if (email) {
              try {
                perfStart('keyInit:registerKey');
                await Promise.race([
                  registerPublicKey(email, pubJwk as JsonWebKey),
                  new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 15000)),
                ]);
                perfEnd('keyInit:registerKey');
              } catch { /* registration failure — key works locally */ }
            }
            setKeyErrorMsg('');
            setKeyError(false);
            setKeyReady(true);
            perfEnd('keyInit:total');
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setKeyErrorMsg(msg);
            setKeyError(true);
          }
          return;
        }

        // Slow path: key needs to be generated — show overlay.
        // This only happens on first install or after explicit key reset.
        perfMark('keyInit:slow-path', 'generating new RSA-2048 key pair');
        setIsKeyGenerating(true);
        perfStart('keyInit:generate');
        const keyTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('انتهت مهلة توليد المفتاح (120 ث) — اضغط إعادة المحاولة')), 120000),
        );
        Promise.race([getOrCreatePublicKey(), keyTimeout]).then(async pubJwk => {
          perfEnd('keyInit:generate');
          const email = nextLegacy.ownerEmail;
          if (email) {
            try {
              perfStart('keyInit:registerKey');
              await Promise.race([
                registerPublicKey(email, pubJwk as JsonWebKey),
                new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 15000)),
              ]);
              perfEnd('keyInit:registerKey');
            } catch {
              // Registration failed — key is generated and stored locally.
            }
          }
          setKeyErrorMsg('');
          setKeyError(false);
          setKeyReady(true);
          setIsKeyGenerating(false);
          perfEnd('keyInit:total');
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          setKeyErrorMsg(msg);
          setKeyError(true);
          setIsKeyGenerating(false);
        });
      }, 600);
    }
  }, [resetSession]);

  // Load the DECOY vault — a fully separate persistent encrypted store keyed by
  // the decoy key. Never surfaces real guardians / legacy / audit history. Same
  // generation guard so a stale real load can never overwrite the decoy session.
  const loadDecoyVault = useCallback(async (key: string) => {
    const gen = ++loadGenerationRef.current;
    try { await resetSession(); } catch { /* clearMediaSession failure — safe to continue with fresh defaults */ }
    if (gen !== loadGenerationRef.current) return; // superseded during reset
    let nextItems = DECOY_ITEMS;
    try {
      const stored = await secureGet(DECOY_VAULT_STORAGE_KEY);
      if (stored) {
        const decrypted = CryptoJS.AES.decrypt(stored, key).toString(CryptoJS.enc.Utf8);
        if (decrypted) nextItems = JSON.parse(decrypted);
      }
    } catch {
      nextItems = DECOY_ITEMS;
    }
    if (gen !== loadGenerationRef.current) return; // superseded during reads
    setDecoyModeState(true);
    setItems(nextItems);
    setGuardians([]);
    setLegacy(DEFAULT_LEGACY);
    setAuditLog([]);
    setVaultKeyState(key);
    setLoadedMode('decoy');
    setIsVaultReady(true);
  }, [resetSession]);

  // Full lock: leave decoy mode and tear the session down. Bumping the
  // generation FIRST guarantees any in-flight load is superseded and can no
  // longer commit, so nothing can repopulate the vault after a lock.
  const lockVaultSession = useCallback(async () => {
    loadGenerationRef.current += 1;
    setDecoyModeState(false);
    await resetSession();
  }, [resetSession]);

  const saveVault = useCallback(async () => {
    // Hard guard against ANY mid-transition write: only persist once the session
    // is fully ready AND the store we'd write to matches the active mode, so real
    // metadata can never land in decoy storage (or vice-versa).
    if (!vaultKey || !isVaultReady) return;
    const targetMode = decoyMode ? 'decoy' : 'real';
    if (loadedMode !== targetMode) return;
    try {
      const storageKey = decoyMode ? DECOY_VAULT_STORAGE_KEY : VAULT_STORAGE_KEY;
      const encrypted = CryptoJS.AES.encrypt(JSON.stringify(items), vaultKey).toString();
      // Write all keys in parallel — sequential awaits meant the audit log
      // (last write) was silently lost when Android killed the process mid-save.
      if (!decoyMode) {
        await Promise.all([
          secureSet(storageKey, encrypted),
          secureSet(GUARDIANS_KEY, JSON.stringify(guardians)),
          secureSet(LEGACY_KEY, JSON.stringify(legacy)),
          asyncSet(AUDIT_LOG_KEY, JSON.stringify(auditLog)),
        ]);
      } else {
        await secureSet(storageKey, encrypted);
      }
    } catch {}
  }, [vaultKey, isVaultReady, loadedMode, decoyMode, items, guardians, legacy, auditLog]);

  useEffect(() => {
    // No `items.length > 0` gate: deleting the LAST item must persist the empty
    // vault, otherwise the deleted metadata reappears on next unlock. The
    // ready + loadedMode guards already prevent saving during a transition.
    // auditLog is included so new audit entries are persisted automatically.
    const targetMode = decoyMode ? 'decoy' : 'real';
    if (vaultKey && isVaultReady && loadedMode === targetMode) {
      const timer = setTimeout(saveVault, 300);
      return () => clearTimeout(timer);
    }
  }, [items, auditLog, vaultKey, isVaultReady, loadedMode, decoyMode, saveVault]);

  // ── AppState background save ───────────────────────────────────────────────
  // Android kills the JS process immediately when the user swipes the app away.
  // The 1-second debounce above never fires in that case, so any change made
  // in the last second is lost (guardians, audit log, legacy settings, etc.).
  //
  // IMPORTANT: we keep a ref to the latest saveVault and register the AppState
  // listener only ONCE (empty dep array). Re-registering on every saveVault
  // change creates a brief window between remove() and addEventListener() where
  // a background event can be silently missed — causing the last action before
  // app close to be lost permanently.
  const saveVaultRef = useRef(saveVault);
  useEffect(() => { saveVaultRef.current = saveVault; }, [saveVault]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'background' || nextState === 'inactive') {
        saveVaultRef.current();
      }
    });
    return () => subscription.remove();
  }, []);

  // ── Post-onboarding RSA init ───────────────────────────────────────────────
  // loadVault skips RSA when ownerName is absent (first launch) to avoid
  // blocking the JS thread during onboarding.  This effect picks up the work
  // the moment the user sets their name and isVaultReady is true.
  // keyInitScheduledRef prevents a double-start when loadVault already ran RSA
  // for returning users.
  useEffect(() => {
    if (!isVaultReady || !legacy.ownerName || keyReady || keyInitScheduledRef.current) return;
    keyInitScheduledRef.current = true;
    const email = legacy.ownerEmail;

    setIsKeyGenerating(true);
    setKeyGenProgress(0);
    setKeyGenPhase('بدء التهيئة…');

    const onProgress = (pct: number, phase: string) => {
      setKeyGenProgress(pct);
      setKeyGenPhase(phase);
    };

    // No timeout on initial generation — node-forge can take 15+ minutes on
    // slow devices and killing it would leave the user without keys.
    // retryKeyGeneration() keeps its own shorter timeout since the user is
    // explicitly retrying and expects a faster response.
    getOrCreatePublicKey(onProgress).then(async pubJwk => {
      if (email) {
        try {
          await Promise.race([
            registerPublicKey(email, pubJwk),
            new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 15000)),
          ]);
        } catch {
          // Key stored locally — registration failed but vault can still seal
        }
      }
      setKeyErrorMsg('');
      setKeyError(false);
      setKeyReady(true);
      setIsKeyGenerating(false);
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      setKeyErrorMsg(msg);
      setKeyError(true);
      setIsKeyGenerating(false);
      setKeyGenProgress(0);
      keyInitScheduledRef.current = false; // allow retry via retryKeyGeneration
    });
  }, [isVaultReady, legacy.ownerName, keyReady]);

  const addItem = useCallback((item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newItem: VaultItem = { ...item, id: generateId(), createdAt: Date.now(), updatedAt: Date.now() };
    setItems(prev => [...prev, newItem]);
    addAuditEntry(`Added item: ${item.title}`);
  }, [addAuditEntry]);

  // Permanently delete any vault item (login, note, document, media, ...).
  // Rejects if the encrypted blob can't be removed so the UI can surface an
  // error and keep the item visible instead of dropping its metadata while the
  // ciphertext lingers on disk.
  const removeItem = useCallback(async (id: string): Promise<void> => {
    // Resolve against the LIVE items (see itemsRef): if the session changed since
    // the delete was requested, the id won't be present here and we no-op safely
    // instead of deleting another session's blob or mutating its state.
    const target = itemsRef.current.find(i => i.id === id);
    if (!target) return; // already gone / not in this session — idempotent success
    const gen = loadGenerationRef.current;
    if (target.mediaRef) {
      // Delete the ciphertext FIRST; errors propagate so the UI can report a
      // failed delete and keep the item visible.
      await deleteEncryptedMedia(target.mediaRef);
      // Best-effort wipe of decrypted plaintext temp. The security-critical blob
      // delete above already succeeded (and surfaces its own errors); temp files
      // are per-view and already cleared on viewer close, so a cleanup failure
      // here must NOT turn a real delete into a reported failure.
      try { await clearMediaTemp(); } catch {}
      // A lock / mode switch may have begun during the awaits and already reset
      // the session; if so, don't mutate the new session's state.
      if (gen !== loadGenerationRef.current) return;
    }
    setItems(prev => prev.filter(i => i.id !== id));
    addAuditEntry(`Removed item: ${target.title}`);
  }, [addAuditEntry]);

  const updateItem = useCallback((id: string, updates: Partial<VaultItem>) => {
    setItems(prev => {
      const existing = prev.find(i => i.id === id);
      if (existing) addAuditEntry(`Updated item: ${updates.title ?? existing.title}`);
      return prev.map(i => i.id === id ? { ...i, ...updates, updatedAt: Date.now() } : i);
    });
  }, [addAuditEntry]);

  const getItemsByCategory = useCallback((cat: VaultCategory) => {
    return items.filter(i => i.category === cat);
  }, [items]);

  // ---------- Encrypted media ----------
  // Media is scoped to the active vault: the REAL key encrypts real media into
  // the real store, the DECOY key encrypts decoy media into a fully separate
  // store. Neither key can decrypt the other's blobs.

  const addMediaItem = useCallback(async (media: PickedMedia, title: string) => {
    // Refuse to save unless the session is fully loaded AND the active mode
    // matches the store we'd write to — never save media mid/post transition.
    const scope: MediaScope = decoyMode ? 'decoy' : 'real';
    if (!vaultKey || !isVaultReady || loadedMode !== scope) throw new Error('locked');
    // Capture the transition generation BEFORE the async encrypt. If the vault
    // locks or switches mode while encryption is in flight, this item belongs to
    // the OLD session and must never be appended to the new one.
    const gen = loadGenerationRef.current;
    const id = generateId();
    const ref = await saveEncryptedMedia(id, media.base64, vaultKey, scope);
    if (gen !== loadGenerationRef.current) {
      // Session changed under us: delete the just-written blob so no orphaned
      // ciphertext lingers, and never leak this item's metadata into the new
      // session. Swallow a cleanup failure so we still throw 'cancelled'.
      try { await deleteEncryptedMedia(ref); } catch {}
      throw new Error('cancelled');
    }
    const now = Date.now();
    const newItem: VaultItem = {
      id,
      category: 'media',
      title: title.trim() || media.fileName,
      subtitle: media.fileName,
      encryptedData: '',
      createdAt: now,
      updatedAt: now,
      mediaKind: media.kind,
      mediaRef: ref,
      mimeType: media.mimeType,
      fileName: media.fileName,
      fileSize: media.fileSize,
    };
    setItems(prev => [...prev, newItem]);
    addAuditEntry(`Added media: ${newItem.title}`);
  }, [vaultKey, isVaultReady, loadedMode, decoyMode, addAuditEntry]);

  const getMediaPreview = useCallback(async (item: VaultItem) => {
    if (!vaultKey || !item.mediaRef) throw new Error('unavailable');
    return getImagePreview(item.mediaRef, item.mimeType ?? 'image/jpeg', vaultKey);
  }, [vaultKey]);

  const getMediaTempFile = useCallback(async (item: VaultItem) => {
    if (!vaultKey || !item.mediaRef) throw new Error('unavailable');
    return prepareTempFile(item.mediaRef, item.fileName ?? 'media', item.mimeType ?? 'application/octet-stream', vaultKey);
  }, [vaultKey]);

  const exportMedia = useCallback(async (item: VaultItem) => {
    if (!item.mediaRef) throw new Error('unavailable');
    return exportEncryptedMedia(item.mediaRef, item.fileName ?? 'media');
  }, []);

  const shareMedia = useCallback(async (item: VaultItem) => {
    if (!vaultKey || !item.mediaRef) throw new Error('unavailable');
    return shareMediaSecurely(item.mediaRef, item.fileName ?? 'media', item.mimeType ?? 'application/octet-stream', vaultKey);
  }, [vaultKey]);

  const clearMedia = useCallback(async () => {
    await clearMediaSession();
    setMediaSessionVersion(v => v + 1);
  }, []);

  const addGuardian = useCallback((g: Omit<Guardian, 'id' | 'addedAt' | 'avatarColor'>): Guardian => {
    const color = GUARDIAN_COLORS[guardians.length % GUARDIAN_COLORS.length];
    const newG: Guardian = { ...g, id: generateId(), addedAt: Date.now(), avatarColor: color };
    setGuardians(prev => [...prev, newG]);
    addAuditEntry(`Added guardian: ${g.name}`, 'app');
    return newG;
  }, [guardians.length, addAuditEntry]);

  const updateGuardian = useCallback((id: string, updates: Partial<Guardian>) => {
    setGuardians(prev => {
      const existing = prev.find(g => g.id === id);
      // Only log meaningful status transitions — not token/metadata-only updates
      if (existing && updates.status && updates.status !== existing.status) {
        const label =
          updates.status === 'active'   ? 'Guardian accepted' :
          updates.status === 'rejected' ? 'Guardian rejected' :
          updates.status === 'inactive' ? 'Guardian deactivated' :
          `Guardian status → ${updates.status}`;
        addAuditEntry(`${label}: ${existing.name}`, 'link');
      }
      return prev.map(g => g.id === id ? { ...g, ...updates } : g);
    });
  }, [addAuditEntry]);

  const removeGuardian = useCallback((id: string) => {
    setGuardians(prev => {
      const g = prev.find(x => x.id === id);
      addAuditEntry(`Removed guardian: ${g?.name ?? id}`);
      return prev.filter(x => x.id !== id);
    });
  }, [addAuditEntry]);

  const updateLegacy = useCallback((settings: Partial<LegacySettings>) => {
    setLegacy(prev => {
      // Log meaningful changes only — skip token/status micro-updates
      if (settings.beneficiary && settings.beneficiary.email !== prev.beneficiary?.email) {
        addAuditEntry(`Beneficiary set: ${settings.beneficiary.name}`);
      } else if (settings.enabled !== undefined && settings.enabled !== prev.enabled) {
        addAuditEntry(settings.enabled ? 'Legacy mode enabled' : 'Legacy mode disabled');
      } else if (settings.absenceDays !== undefined && settings.absenceDays !== prev.absenceDays) {
        addAuditEntry(`Absence timer set: ${settings.absenceDays} days`);
      }
      return { ...prev, ...settings };
    });
  }, [addAuditEntry]);

  /**
   * Seal the owner's vault for legacy transfer.
   *
   * ─── What this does (NOT an end-of-session lock) ──────────────────────────
   * Produces a cryptographic sealed package from the current vault contents
   * and uploads it to the server.  The owner's vault is NOT affected — they
   * keep their session active and can keep using the app normally.
   * The sealed package can be refreshed at any time by pressing the button again.
   *
   * ─── Three-layer encryption ───────────────────────────────────────────────
   *
   *   Layer 1 — AES-256 (CryptoJS)
   *     Each vault item is decrypted with the active PIN-derived vaultKey, then
   *     the full snapshot is re-encrypted with a fresh random 32-byte Transfer
   *     Key (TK).  The AES blob is stored on the server.
   *     → Requires: vault is UNLOCKED (isVaultReady && vaultKey set).
   *
   *   Layer 2 — RSA-OAEP-2048 (keyManager.ts / getOrCreatePublicKey)
   *     TK is encrypted with the beneficiary's RSA public key fetched from the
   *     server.  Only their device's private key (SecureStore) can decrypt it
   *     directly.  If the beneficiary never launched Auryx, their key won't be
   *     registered yet → beneficiaryKeyIncluded = false.
   *
   *   Layer 3 — Shamir Secret Sharing (shamirUtils.ts)
   *     TK is split into N guardian shares (threshold K = mOfN.m).  Each share
   *     is RSA-encrypted with the corresponding guardian's registered public key.
   *     When K guardians approve, the beneficiary can reconstruct TK via Shamir
   *     combination — even without a direct RSA path (Layer 2).
   *
   * ─── Preconditions ────────────────────────────────────────────────────────
   *   • Vault must be unlocked in REAL mode (not decoy).
   *   • legacy.beneficiary.email must be set.
   *   • At least one active guardian should be present (enforced by UI, not here).
   *
   * Returns SealResult with:
   *   success: boolean
   *   missingKeys?: string[]  — guardian emails with no registered RSA key
   *   beneficiaryKeyIncluded  — whether direct RSA path was included
   */
  const sealVaultForLegacy = useCallback(async (): Promise<SealResult> => {
    if (!vaultKey || !isVaultReady || decoyMode) {
      return { success: false, error: 'الخزنة مقفلة أو في وضع التمويه', beneficiaryKeyIncluded: false };
    }
    if (!legacy.beneficiary?.email) {
      return { success: false, error: 'لا يوجد مستفيد — يرجى تحديد المستفيد أولاً', beneficiaryKeyIncluded: false };
    }
    return sealVault({
      items,
      vaultKey,
      guardians,
      beneficiary: legacy.beneficiary,
      ownerName: legacy.ownerName ?? 'صاحب الخزنة',
      ownerEmail: legacy.ownerEmail ?? '',
      mOfN: legacy.mOfN,
    });
  }, [vaultKey, isVaultReady, decoyMode, items, guardians, legacy]);

  const approveGuardianLegacy = useCallback(async (ownerEmail: string) => {
    const guardianEmail = legacy.ownerEmail ?? '';
    return approveGuardianAccess({ ownerEmail, guardianEmail });
  }, [legacy.ownerEmail]);

  /**
   * Retry RSA key generation + server registration.
   * Called by the legacy screen when:
   *   - Key generation previously timed out or failed (keyError = true)
   *   - Beneficiary changes — re-register with the updated ownerEmail
   *
   * On every retry we:
   *   1. Clear the in-memory key cache so we never serve a stale cached key.
   *   2. Call generateAndStoreKeyPair() directly (forces a fresh RSA-2048
   *      generation — unlike getOrCreatePublicKey() which returns the stored
   *      key unchanged if one already exists).
   *   3. Await registerPublicKey() with its own 15 s timeout so we know
   *      the server actually received the key before reporting success.
   */
  const retryKeyGeneration = useCallback(async (ownerEmail?: string): Promise<boolean> => {
    setKeyReady(false);
    setKeyError(false);
    setKeyErrorMsg('');
    setIsKeyGenerating(true);
    setKeyGenProgress(0);
    setKeyGenPhase('إعادة التهيئة…');
    const email = ownerEmail ?? legacy.ownerEmail ?? '';

    // Clear cache — next call must generate fresh, not return a cached value
    clearKeyCache();

    const onProgress = (pct: number, phase: string) => {
      setKeyGenProgress(pct);
      setKeyGenPhase(phase);
    };

    let pubJwk: JsonWebKey;
    try {
      pubJwk = await generateAndStoreKeyPair(onProgress);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setKeyErrorMsg(msg);
      setKeyError(true);
      setIsKeyGenerating(false);
      setKeyGenProgress(0);
      return false;
    }

    // Register on server — separate timeout (15 s) so a slow network doesn't
    // block indefinitely while the key itself was generated successfully.
    if (email) {
      const regTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('انتهت مهلة تسجيل المفتاح على الخادم (15 ث)')), 15000),
      );
      try {
        await Promise.race([registerPublicKey(email, pubJwk), regTimeout]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Key is generated and stored locally — set keyReady so the vault
        // can still be sealed. Surface the registration failure as a warning.
        setKeyErrorMsg(`المفتاح جاهز محلياً لكن تسجيله على الخادم فشل: ${msg}`);
        setKeyError(false);
        setKeyReady(true);
        return true; // Partial success — generation OK, registration failed
      }
    }

    setKeyErrorMsg('');
    setKeyError(false);
    setKeyReady(true);
    setIsKeyGenerating(false);
    return true;
  }, [legacy.ownerEmail]);

  const getWeakItemsCount = useCallback(() => {
    return items.filter(i => i.strength === 'weak').length;
  }, [items]);

  return (
    <VaultContext.Provider value={{
      items, guardians, legacy, auditLog, decoyMode, mediaSessionVersion, isVaultReady,
      addItem, removeItem, updateItem, getItemsByCategory,
      addMediaItem, getMediaPreview, getMediaTempFile, exportMedia, shareMedia, clearMediaSession: clearMedia,
      encryptData, decryptData, addGuardian, updateGuardian, removeGuardian,
      updateLegacy, addAuditEntry, loadVault, loadDecoyVault, lockVaultSession, saveVault, getWeakItemsCount,
      sealVaultForLegacy, approveGuardianLegacy, keyReady, keyError, keyErrorMsg, isKeyGenerating, retryKeyGeneration,
      vaultLoadPhase, keyGenProgress, keyGenPhase,
    }}>
      {children}
    </VaultContext.Provider>
  );
}

export const useVault = () => useContext(VaultContext);

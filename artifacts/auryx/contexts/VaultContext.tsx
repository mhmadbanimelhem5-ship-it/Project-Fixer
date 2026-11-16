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
import { getApiBase } from '@/utils/apiBase';
import { encryptGCM, decryptGCM, secureRandomHex, deriveInnerKey } from '@/utils/cryptoUtils';

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
  encryptData: (data: string) => Promise<string>;
  decryptData: (encrypted: string) => Promise<string>;
  addGuardian: (g: Omit<Guardian, 'id' | 'addedAt' | 'avatarColor'>) => Guardian;
  updateGuardian: (id: string, updates: Partial<Guardian>) => void;
  removeGuardian: (id: string) => void;
  updateLegacy: (settings: Partial<LegacySettings>) => void;
  addAuditEntry: (action: string, source?: 'app' | 'link') => void;
  isVaultReady: boolean;
  /** P1-4: non-null when the last persistence attempt failed; UI should surface a warning. */
  saveError: string | null;
  loadVault: (key: string) => Promise<void>;
  loadDecoyVault: (key: string) => Promise<void>;
  lockVaultSession: () => Promise<void>;
  saveVault: () => Promise<void>;
  getWeakItemsCount: () => number;
  sealVaultForLegacy: () => Promise<SealResult>;
  approveGuardianLegacy: (ownerEmail: string) => Promise<{ success: boolean; error?: string }>;
  keyReady: boolean;
  keyError: boolean;
  keyErrorMsg: string;
  isKeyGenerating: boolean;
  retryKeyGeneration: (ownerEmail?: string) => Promise<boolean>;
  vaultLoadPhase: string;
  keyGenProgress: number;
  keyGenPhase: string;
}

const VAULT_STORAGE_KEY = 'auryx_vault_data';
const DECOY_VAULT_STORAGE_KEY = 'auryx_decoy_vault_data';
const GUARDIANS_KEY = 'auryx_guardians';
const LEGACY_KEY = 'auryx_legacy';
const AUDIT_LOG_KEY = 'auryx:audit:log';

const AUDIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// P1-4: bounded automatic retry budget for failed persistence (backoff 1,2,4,8,15s).
const MAX_SAVE_RETRIES = 5;
const DEFAULT_LEGACY: LegacySettings = { absenceDays: 30, mOfN: { m: 2, n: 3 }, enabled: false, userRole: 'owner' };

const VaultContext = createContext<VaultContextType>({} as VaultContextType);
const GUARDIAN_COLORS = ['#8B5CF6', '#3B82F6', '#D4AF37', '#EF4444', '#14B8A6', '#F97316'];

async function secureGet(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return localStorage.getItem(key);
    return await SecureStore.getItemAsync(key);
  } catch { return null; }
}

// P1-4: write errors PROPAGATE by design. Callers (saveVault / addAuditEntry)
// are responsible for handling failure; silent swallowing caused data loss.
async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    // P1-1: web persistence is DEV-ONLY. Production web must never store vault
    // material in localStorage (readable by any same-origin script / XSS).
    if (!__DEV__) throw new Error('web_persistence_disabled_in_production');
    localStorage.setItem(key, value); return;
  }
  await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED });
}

async function asyncGet(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return localStorage.getItem(key);
    return await AsyncStorage.getItem(key);
  } catch { return null; }
}

// P1-4: write errors PROPAGATE by design (see secureSet).
async function asyncSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (!__DEV__) throw new Error('web_persistence_disabled_in_production');
    localStorage.setItem(key, value); return;
  }
  await AsyncStorage.setItem(key, value);
}

type StrictRead =
  | { status: 'present'; value: string }
  | { status: 'missing' }
  | { status: 'storage_error'; error: unknown };

async function secureGetStrict(key: string): Promise<StrictRead> {
  try {
    if (Platform.OS === 'web') {
      if (!__DEV__) return { status: 'storage_error', error: new Error('web_persistence_disabled_in_production') };
      const v = localStorage.getItem(key);
      return v === null ? { status: 'missing' } : { status: 'present', value: v };
    }
    const v = await SecureStore.getItemAsync(key);
    return v === null ? { status: 'missing' } : { status: 'present', value: v };
  } catch (e) {
    return { status: 'storage_error', error: e };
  }
}

async function asyncGetStrict(key: string): Promise<StrictRead> {
  try {
    if (Platform.OS === 'web') {
      if (!__DEV__) return { status: 'storage_error', error: new Error('web_persistence_disabled_in_production') };
      const v = localStorage.getItem(key);
      return v === null ? { status: 'missing' } : { status: 'present', value: v };
    }
    const v = await AsyncStorage.getItem(key);
    return v === null ? { status: 'missing' } : { status: 'present', value: v };
  } catch (e) {
    return { status: 'storage_error', error: e };
  }
}

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

// P2-7: deterministic hash over the STORED fields only (no hidden Date.now()),
// so any verifier can recompute the chain from the persisted log.
function computeBlockHash(entry: Omit<AuditEntry, 'blockHash'>): string {
  const canonical = JSON.stringify([entry.id, entry.action, entry.timestamp, entry.prevHash, entry.source ?? 'app']);
  return CryptoJS.SHA256(entry.prevHash + canonical).toString();
}

/** P2-7: recompute the chain from persisted entries; false on any tampering. */
export function verifyAuditChain(log: AuditEntry[]): boolean {
  let prev = '0';
  for (const e of log) {
    if (e.prevHash !== prev) return false;
    if (computeBlockHash(e) !== e.blockHash) return false;
    prev = e.blockHash;
  }
  return true;
}

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [legacy, setLegacy] = useState<LegacySettings>(DEFAULT_LEGACY);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [vaultKey, setVaultKeyState] = useState<string | null>(null);
  const [decoyMode, setDecoyModeState] = useState(false);
  const [isVaultReady, setIsVaultReady] = useState(false);
  const [vaultLoadPhase, setVaultLoadPhase] = useState('');
  const [loadedMode, setLoadedMode] = useState<'none' | 'real' | 'decoy'>('none');
  const [mediaSessionVersion, setMediaSessionVersion] = useState(0);
  const [keyReady, setKeyReady] = useState(false);
  const [keyError, setKeyError] = useState(false);
  const [keyErrorMsg, setKeyErrorMsg] = useState('');
  const [isKeyGenerating, setIsKeyGenerating] = useState(false);
  const [keyGenProgress, setKeyGenProgress] = useState(0);
  const [keyGenPhase, setKeyGenPhase] = useState('');
  // P1-4: outstanding persistence failure (nonce forces retry-effect re-trigger).
  const [saveFailure, setSaveFailure] = useState<{ msg: string; nonce: number } | null>(null);
  const saveError = saveFailure ? saveFailure.msg : null;

  const loadGenerationRef = useRef(0);
  const keyInitScheduledRef = useRef(false);
  const saveRetryCountRef = useRef(0);

  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const auditLogRef = useRef<AuditEntry[]>([]);
  const guardiansRef = useRef<Guardian[]>([]);
  const legacyRef = useRef<LegacySettings>(DEFAULT_LEGACY);
  const auditTrustedRef = useRef<boolean>(true);

  useEffect(() => { auditLogRef.current = auditLog; }, [auditLog]);
  useEffect(() => { guardiansRef.current = guardians; }, [guardians]);
  useEffect(() => { legacyRef.current = legacy; }, [legacy]);

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
    setSaveFailure(null);
    keyInitScheduledRef.current = false;
    auditTrustedRef.current = true;

    await Promise.race([
      clearMediaSession(),
      new Promise<void>(resolve => setTimeout(resolve, 2000)),
    ]);
    setMediaSessionVersion(v => v + 1);
  }, []);

  // P3-1/P3-2: inner item layer = AES-256-GCM under an HKDF-derived inner key
  // (separate from the outer envelope key). Async by design.
  const encryptData = useCallback(async (data: string): Promise<string> => {
    if (!vaultKey) return data;
    return encryptGCM(data, deriveInnerKey(vaultKey));
  }, [vaultKey]);

  const decryptData = useCallback(async (encrypted: string): Promise<string> => {
    if (!vaultKey || !encrypted) return '';
    return (await decryptGCM(encrypted, deriveInnerKey(vaultKey))) ?? '';
  }, [vaultKey]);

  const addAuditEntry = useCallback((action: string, source?: 'app' | 'link') => {
    const prev = auditLogRef.current;
    const prevHash = prev.length > 0 ? prev[prev.length - 1].blockHash : '0';
    const src: 'app' | 'link' = source ?? 'app';
    const base = { id: generateId(), action, timestamp: Date.now(), prevHash, source: src };
    const blockHash = computeBlockHash(base);
    const next: AuditEntry[] = [...prev, { ...base, blockHash }];

    auditLogRef.current = next;
    setAuditLog(next);

    if (!auditTrustedRef.current) return;

    const snapshot = next.slice();
    asyncSet(AUDIT_LOG_KEY, JSON.stringify(snapshot)).catch(() => {
      // Entry stays in memory; the debounced saveVault retries persistence.
    });
  }, []);

  const loadVault = useCallback(async (key: string) => {
    perfStart('loadVault:total');
    const gen = ++loadGenerationRef.current;
    setVaultLoadPhase('جارٍ تهيئة الجلسة');
    try { await resetSession(); } catch { /* safe to continue with fresh defaults */ }
    if (gen !== loadGenerationRef.current) return;

    let nextItems: VaultItem[] = [];
    let nextGuardians: Guardian[] = [];
    let nextLegacy: LegacySettings = DEFAULT_LEGACY;

    setVaultLoadPhase('جارٍ فك تشفير البيانات');
    perfStart('loadVault:secureReads');

    const vaultRead = await secureGetStrict(VAULT_STORAGE_KEY);
    if (vaultRead.status === 'storage_error') {
      perfEnd('loadVault:secureReads');
      perfEnd('loadVault:total');
      setVaultLoadPhase('Storage read failed - vault stays locked');
      return;
    }
    if (vaultRead.status === 'present' && vaultRead.value) {
      const decrypted = (await decryptGCM(vaultRead.value, key)) ?? '';

      if (!decrypted) {
        perfEnd('loadVault:secureReads');
        perfEnd('loadVault:total');
        setVaultLoadPhase('Decrypt failed - no data was modified');
        return;
      }
      try {
        const parsedItems = JSON.parse(decrypted);
        if (!Array.isArray(parsedItems)) throw new Error('Invalid format');
        nextItems = parsedItems as VaultItem[];
      } catch {
        perfEnd('loadVault:secureReads');
        perfEnd('loadVault:total');
        setVaultLoadPhase('Vault data corrupt - no data was modified');
        return;
      }
    }

    const guardiansRead = await secureGetStrict(GUARDIANS_KEY);
    const legacyRead = await secureGetStrict(LEGACY_KEY);
    if (guardiansRead.status === 'storage_error' || legacyRead.status === 'storage_error') {
      perfEnd('loadVault:secureReads');
      perfEnd('loadVault:total');
      setVaultLoadPhase('Metadata read failed - vault stays locked');
      return;
    }
    try {
      if (guardiansRead.status === 'present' && guardiansRead.value) nextGuardians = JSON.parse(guardiansRead.value) as Guardian[];
      if (legacyRead.status === 'present' && legacyRead.value) nextLegacy = JSON.parse(legacyRead.value) as LegacySettings;
    } catch {
      perfEnd('loadVault:secureReads');
      perfEnd('loadVault:total');
      setVaultLoadPhase('Metadata corrupt - vault stays locked');
      return;
    }
    perfEnd('loadVault:secureReads');

    setVaultLoadPhase('جارٍ تحميل سجل الأمان');
    perfStart('loadVault:auditLog');
    let nextAuditLog: AuditEntry[] = [];
    const auditRead = await asyncGetStrict(AUDIT_LOG_KEY);

    if (auditRead.status === 'storage_error') {
      auditTrustedRef.current = false;
    } else if (auditRead.status === 'missing') {
      const legacyProbe = await secureGetStrict(AUDIT_LOG_KEY);
      if (legacyProbe.status === 'present' && legacyProbe.value) {
        void asyncSet(AUDIT_LOG_KEY, legacyProbe.value).catch(() => {});
        SecureStore.deleteItemAsync(AUDIT_LOG_KEY).catch(() => {});
        try {
          const migrated: AuditEntry[] = JSON.parse(legacyProbe.value);
          nextAuditLog = migrated.filter(e => e.timestamp > Date.now() - AUDIT_TTL_MS);
          auditTrustedRef.current = true;
        } catch { auditTrustedRef.current = false; }
      } else if (legacyProbe.status === 'missing') {
        auditTrustedRef.current = true;
      } else {
        auditTrustedRef.current = false;
      }
    } else {
      try {
        const parsedAudit: AuditEntry[] = JSON.parse(auditRead.value);
        nextAuditLog = parsedAudit.filter(e => e.timestamp > Date.now() - AUDIT_TTL_MS);
        auditTrustedRef.current = true;
      } catch { auditTrustedRef.current = false; }
    }
    perfEnd('loadVault:auditLog');

    if (gen !== loadGenerationRef.current) return;

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

    setTimeout(() => {
      fetch(`${getApiBase()}/api/healthz`, { method: 'GET' }).catch(() => {});
    }, 800);

    if (nextLegacy.ownerName) {
      keyInitScheduledRef.current = true;
      setTimeout(async () => {
        perfStart('keyInit:total');
        const keyExists = await hasKeyPair();
        if (keyExists) {
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
            setKeyErrorMsg(err instanceof Error ? err.message : String(err));
            setKeyError(true);
          }
          return;
        }

        perfMark('keyInit:slow-path', 'generating new RSA-2048 key pair');
        setIsKeyGenerating(true);
        perfStart('keyInit:generate');
        const keyTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('انتهت مهلة توليد المفتاح (120 ث) — اضغط إعادة المحاولة')), 120000)
        );
        Promise.race([getOrCreatePublicKey(), keyTimeout]).then(async pubJwk => {
          perfEnd('keyInit:generate');
          const email = nextLegacy.ownerEmail;
          if (email) {
            try {
              await Promise.race([
                registerPublicKey(email, pubJwk as JsonWebKey),
                new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 15000)),
              ]);
            } catch { /* Registration failed — key is generated and stored locally */ }
          }
          setKeyErrorMsg('');
          setKeyError(false);
          setKeyReady(true);
          setIsKeyGenerating(false);
          perfEnd('keyInit:total');
        }).catch((err: unknown) => {
          setKeyErrorMsg(err instanceof Error ? err.message : String(err));
          setKeyError(true);
          setIsKeyGenerating(false);
        });
      }, 600);
    }
  }, [resetSession]);

  const loadDecoyVault = useCallback(async (key: string) => {
    const gen = ++loadGenerationRef.current;
    try { await resetSession(); } catch { /* safe to continue */ }
    if (gen !== loadGenerationRef.current) return;

    let nextItems: VaultItem[] = [];
    const decoyRead = await secureGetStrict(DECOY_VAULT_STORAGE_KEY);
    if (decoyRead.status === 'storage_error') return;

    if (decoyRead.status === 'present' && decoyRead.value) {
      const decrypted = (await decryptGCM(decoyRead.value, key)) ?? '';
      if (!decrypted) return;
      try {
        const parsed = JSON.parse(decrypted);
        if (!Array.isArray(parsed)) return;
        nextItems = parsed as VaultItem[];
      } catch { return; }
    }

    if (gen !== loadGenerationRef.current) return;
    setDecoyModeState(true);
    setItems(nextItems);
    setGuardians([]);
    setLegacy(DEFAULT_LEGACY);
    setAuditLog([]);
    setVaultKeyState(key);
    setLoadedMode('decoy');
    setIsVaultReady(true);
  }, [resetSession]);

  const lockVaultSession = useCallback(async () => {
    loadGenerationRef.current += 1;
    setDecoyModeState(false);
    await resetSession();
  }, [resetSession]);

  const saveVault = useCallback(async () => {
    if (!vaultKey || !isVaultReady) return;
    const targetMode = decoyMode ? 'decoy' : 'real';
    if (loadedMode !== targetMode) return;
    const gen = loadGenerationRef.current;

    try {
      const storageKey = decoyMode ? DECOY_VAULT_STORAGE_KEY : VAULT_STORAGE_KEY;
      const itemsSnap = itemsRef.current;
      const guardiansSnap = guardiansRef.current;
      const legacySnap = legacyRef.current;
      const auditSnap = auditLogRef.current;
      const writeAudit = auditTrustedRef.current;

      const encrypted = await encryptGCM(JSON.stringify(itemsSnap), vaultKey);
      if (gen !== loadGenerationRef.current) return; // session changed mid-encrypt

      // Write all keys in parallel; allSettled lets us report partial failures
      // precisely instead of losing them to a single rejected Promise.all.
      const writes: Promise<void>[] = [secureSet(storageKey, encrypted)];
      if (!decoyMode) {
        writes.push(
          secureSet(GUARDIANS_KEY, JSON.stringify(guardiansSnap)),
          secureSet(LEGACY_KEY, JSON.stringify(legacySnap)),
        );
        if (writeAudit) writes.push(asyncSet(AUDIT_LOG_KEY, JSON.stringify(auditSnap)));
      }
      const results = await Promise.allSettled(writes);
      if (gen !== loadGenerationRef.current) return; // session changed mid-write

      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        const first = failed[0];
        const reason = first.status === 'rejected' ? String(first.reason) : 'unknown';
        setSaveFailure({ msg: `فشل حفظ الخزنة (${failed.length}/${results.length}): ${reason}`, nonce: Date.now() });
      } else {
        setSaveFailure(null);
      }
    } catch (e) {
      if (gen !== loadGenerationRef.current) return;
      setSaveFailure({ msg: `فشل حفظ الخزنة: ${e instanceof Error ? e.message : String(e)}`, nonce: Date.now() });
    }
  }, [vaultKey, isVaultReady, loadedMode, decoyMode]); // ✅ FIXED: Removed state vars, relying purely on refs

  useEffect(() => {
    const targetMode = decoyMode ? 'decoy' : 'real';
    if (vaultKey && isVaultReady && loadedMode === targetMode) {
      const timer = setTimeout(saveVault, 300);
      return () => clearTimeout(timer);
    }
  }, [items, auditLog, vaultKey, isVaultReady, loadedMode, decoyMode, saveVault]);

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

  // P1-4: bounded automatic retry with exponential backoff while a save failure
  // is outstanding. Stops after MAX_SAVE_RETRIES; the banner then persists until
  // a manual saveVault() or the next state change / AppState event succeeds.
  useEffect(() => {
    if (!saveFailure) { saveRetryCountRef.current = 0; return; }
    if (saveRetryCountRef.current >= MAX_SAVE_RETRIES) return;
    const delay = Math.min(1000 * 2 ** saveRetryCountRef.current, 15000);
    saveRetryCountRef.current += 1;
    const t = setTimeout(() => { void saveVaultRef.current(); }, delay);
    return () => clearTimeout(t);
  }, [saveFailure]);

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

    getOrCreatePublicKey(onProgress).then(async pubJwk => {
      if (email) {
        try {
          await Promise.race([
            registerPublicKey(email, pubJwk),
            new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 15000)),
          ]);
        } catch { /* Key stored locally — registration failed but vault can still seal */ }
      }
      setKeyErrorMsg('');
      setKeyError(false);
      setKeyReady(true);
      setIsKeyGenerating(false);
    }).catch((err: unknown) => {
      setKeyErrorMsg(err instanceof Error ? err.message : String(err));
      setKeyError(true);
      setIsKeyGenerating(false);
      setKeyGenProgress(0);
      keyInitScheduledRef.current = false;
    });
  }, [isVaultReady, legacy.ownerName, keyReady]);

  const addItem = useCallback((item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newItem: VaultItem = { ...item, id: generateId(), createdAt: Date.now(), updatedAt: Date.now() };
    setItems(prev => [...prev, newItem]);
    addAuditEntry(`Added item: ${item.title}`);
  }, [addAuditEntry]);

  const removeItem = useCallback(async (id: string): Promise<void> => {
    const target = itemsRef.current.find(i => i.id === id);
    if (!target) return;
    const gen = loadGenerationRef.current;

    if (target.mediaRef) {
      await deleteEncryptedMedia(target.mediaRef);
      try { await clearMediaTemp(); } catch {}
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

  const getItemsByCategory = useCallback((cat: VaultCategory) => items.filter(i => i.category === cat), [items]);

  const addMediaItem = useCallback(async (media: PickedMedia, title: string) => {
    const scope: MediaScope = decoyMode ? 'decoy' : 'real';
    if (!vaultKey || !isVaultReady || loadedMode !== scope) throw new Error('locked');
    const gen = loadGenerationRef.current;
    // P3-3: mediaRef is a capability reference — derive it from a CSPRNG, not
    // Math.random, so blob paths cannot be enumerated/guessed.
    const id = await secureRandomHex(16);
    const ref = await saveEncryptedMedia(id, media.base64, vaultKey, scope);

    if (gen !== loadGenerationRef.current) {
      try { await deleteEncryptedMedia(ref); } catch {}
      throw new Error('cancelled');
    }
    const now = Date.now();
    const newItem: VaultItem = {
      id, category: 'media', title: title.trim() || media.fileName, subtitle: media.fileName,
      encryptedData: '', createdAt: now, updatedAt: now,
      mediaKind: media.kind, mediaRef: ref, mimeType: media.mimeType,
      fileName: media.fileName, fileSize: media.fileSize,
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
      if (existing && updates.status && updates.status !== existing.status) {
        const label = updates.status === 'active' ? 'Guardian accepted' :
                      updates.status === 'rejected' ? 'Guardian rejected' :
                      updates.status === 'inactive' ? 'Guardian deactivated' : `Guardian status → ${updates.status}`;
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

  const sealVaultForLegacy = useCallback(async (): Promise<SealResult> => {
    if (!vaultKey || !isVaultReady || decoyMode) {
      return { success: false, error: 'الخزنة مقفلة أو في وضع التمويه', beneficiaryKeyIncluded: false };
    }
    if (!legacy.beneficiary?.email) {
      return { success: false, error: 'لا يوجد مستفيد — يرجى تحديد المستفيد أولاً', beneficiaryKeyIncluded: false };
    }
    return sealVault({
      items, vaultKey, guardians, beneficiary: legacy.beneficiary,
      ownerName: legacy.ownerName ?? 'صاحب الخزنة', ownerEmail: legacy.ownerEmail ?? '', mOfN: legacy.mOfN,
    });
  }, [vaultKey, isVaultReady, decoyMode, items, guardians, legacy]);

  const approveGuardianLegacy = useCallback(async (ownerEmail: string) => {
    const guardianEmail = legacy.ownerEmail ?? '';
    return approveGuardianAccess({ ownerEmail, guardianEmail });
  }, [legacy.ownerEmail]);

  const retryKeyGeneration = useCallback(async (ownerEmail?: string): Promise<boolean> => {
    setKeyReady(false);
    setKeyError(false);
    setKeyErrorMsg('');
    setIsKeyGenerating(true);
    setKeyGenProgress(0);
    setKeyGenPhase('إعادة التهيئة…');
    const email = ownerEmail ?? legacy.ownerEmail ?? '';
    clearKeyCache();

    const onProgress = (pct: number, phase: string) => {
      setKeyGenProgress(pct);
      setKeyGenPhase(phase);
    };

    let pubJwk: JsonWebKey;
    try {
      pubJwk = await generateAndStoreKeyPair(onProgress);
    } catch (err: unknown) {
      setKeyErrorMsg(err instanceof Error ? err.message : String(err));
      setKeyError(true);
      setIsKeyGenerating(false);
      setKeyGenProgress(0);
      return false;
    }

    if (email) {
      const regTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('انتهت مهلة تسجيل المفتاح على الخادم (15 ث)')), 15000)
      );
      try {
        await Promise.race([registerPublicKey(email, pubJwk), regTimeout]);
      } catch (err: unknown) {
        setKeyErrorMsg(`المفتاح جاهز محلياً لكن تسجيله على الخادم فشل: ${err instanceof Error ? err.message : String(err)}`);
        setKeyError(false);
        setKeyReady(true);
        return true;
      }
    }

    setKeyErrorMsg('');
    setKeyError(false);
    setKeyReady(true);
    setIsKeyGenerating(false);
    return true;
  }, [legacy.ownerEmail]);

  const getWeakItemsCount = useCallback(() => items.filter(i => i.strength === 'weak').length, [items]);

  return (
    <VaultContext.Provider value={{
      items, guardians, legacy, auditLog, decoyMode, mediaSessionVersion, isVaultReady, saveError,
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
import { Platform } from 'react-native';
import CryptoJS from 'crypto-js';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

export type MediaKind = 'image' | 'video' | 'file';

export interface PickedMedia {
  base64: string;
  mimeType: string;
  fileName: string;
  fileSize: number;
  kind: MediaKind;
}

export type PickReason = 'cancelled' | 'too_large' | 'permission' | 'error';
export type PickResult = { ok: true; data: PickedMedia } | { ok: false; reason: PickReason };

// Cap the media size. CryptoJS AES runs entirely in JS and loads the whole file
// into memory, so very large files risk OOM crashes on device.
export const MAX_MEDIA_BYTES = 30 * 1024 * 1024; // 30 MB

export type MediaScope = 'real' | 'decoy';

// Real and decoy media live in fully separate directories / storage prefixes so
// the two encrypted vaults can never read or overwrite each other's blobs.
const WEB_PREFIX_REAL = 'auryx_media_';
const WEB_PREFIX_DECOY = 'auryx_decoy_media_';
const MEDIA_DIR_REAL = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}auryx_media/` : '';
const MEDIA_DIR_DECOY = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}auryx_decoy_media/` : '';
const TMP_DIR = FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}auryx_tmp/` : '';

function mediaDirFor(scope: MediaScope): string {
  return scope === 'decoy' ? MEDIA_DIR_DECOY : MEDIA_DIR_REAL;
}
function webPrefixFor(scope: MediaScope): string {
  return scope === 'decoy' ? WEB_PREFIX_DECOY : WEB_PREFIX_REAL;
}

// In-memory cache of decrypted image data URIs (only lives while unlocked).
const previewCache = new Map<string, string>();

// Bumped every time the session is wiped (lock / logout / decoy transition).
// In-flight decrypts capture this at start and refuse to cache/write plaintext
// if it changed while they were running, so a wipe can't be silently undone.
let sessionEpoch = 0;

function approxBase64Bytes(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || `media_${Date.now()}`;
}

async function ensureDir(dir: string): Promise<void> {
  if (Platform.OS === 'web' || !dir) return;
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {}
}

async function uriToBase64(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        resolve(result.includes(',') ? result.split(',')[1] : '');
      };
      reader.onerror = () => reject(new Error('read_failed'));
      reader.readAsDataURL(blob);
    });
  }
  return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

// ---------- Image Compression ----------
// Compresses an image before encryption to reduce:
//   • base64 string length → less memory pressure
//   • CryptoJS work per byte  → faster encrypt/decrypt
//   • stored blob size        → less disk usage
// Quality targets are tuned to be invisible at normal viewing sizes.
// Falls back silently to the original URI on any error — the save always
// proceeds, just without compression.
async function compressImageUri(uri: string, originalBytes: number): Promise<string> {
  if (Platform.OS === 'web') return uri; // no ImageManipulator on web

  // Choose quality & whether to also resize based on original file size
  const quality =
    originalBytes > 8 * 1024 * 1024 ? 0.55 :
    originalBytes > 4 * 1024 * 1024 ? 0.65 :
    originalBytes > 1 * 1024 * 1024 ? 0.75 : 0.85;

  // Only resize images bigger than 8 MB (camera shots often 12-15 MP)
  const shouldResize = originalBytes > 8 * 1024 * 1024;

  try {
    const result = await manipulateAsync(
      uri,
      shouldResize ? [{ resize: { width: 1600 } }] : [],
      { compress: quality, format: SaveFormat.JPEG },
    );
    return result.uri;
  } catch {
    return uri;
  }
}

// ---------- Encryption (AES-256 encrypt-then-HMAC for integrity) ----------

function encryptPayload(base64: string, key: string): string {
  const ct = CryptoJS.AES.encrypt(base64, key).toString();
  const mac = CryptoJS.HmacSHA256(ct, key).toString();
  return JSON.stringify({ v: 1, ct, mac });
}

function decryptPayload(stored: string, key: string): string {
  let obj: { v?: number; ct?: string; mac?: string };
  try {
    obj = JSON.parse(stored);
  } catch {
    throw new Error('corrupt');
  }
  if (!obj.ct || !obj.mac) throw new Error('corrupt');
  const expected = CryptoJS.HmacSHA256(obj.ct, key).toString();
  if (expected !== obj.mac) throw new Error('integrity'); // wrong key or tampered
  const b64 = CryptoJS.AES.decrypt(obj.ct, key).toString(CryptoJS.enc.Utf8);
  if (!b64) throw new Error('decrypt_failed');
  return b64;
}

// ---------- Pickers ----------

export async function pickImage(): Promise<PickResult> {
  let srcUri: string | undefined;
  let compressedUri: string | undefined;
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'permission' };
    // Pick at quality 1 — we compress ourselves so we control the output size
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (res.canceled || !res.assets?.length) return { ok: false, reason: 'cancelled' };
    const a = res.assets[0];
    srcUri = a.uri;

    let size = a.fileSize ?? 0;
    if (!size && Platform.OS !== 'web') {
      try {
        const info = await FileSystem.getInfoAsync(a.uri);
        if (info.exists && !info.isDirectory) size = (info as { size?: number }).size ?? 0;
      } catch {}
    }
    if (size > MAX_MEDIA_BYTES) return { ok: false, reason: 'too_large' };

    // Compress before reading as base64 — reduces memory + encrypt time
    const uriToRead = await compressImageUri(a.uri, size || 2 * 1024 * 1024);
    if (uriToRead !== a.uri) compressedUri = uriToRead;

    const base64 = await uriToBase64(uriToRead);
    const realSize = approxBase64Bytes(base64);
    if (realSize > MAX_MEDIA_BYTES) return { ok: false, reason: 'too_large' };
    return {
      ok: true,
      data: {
        base64,
        mimeType: 'image/jpeg',
        fileName: a.fileName?.replace(/\.\w+$/, '.jpg') ?? `image_${Date.now()}.jpg`,
        fileSize: realSize,
        kind: 'image',
      },
    };
  } catch {
    return { ok: false, reason: 'error' };
  } finally {
    await deleteSourceFile(srcUri);
    await deleteSourceFile(compressedUri);
  }
}

export async function pickVideo(): Promise<PickResult> {
  let srcUri: string | undefined;
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'permission' };
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
    if (res.canceled || !res.assets?.length) return { ok: false, reason: 'cancelled' };
    const a = res.assets[0];
    srcUri = a.uri;
    let size = a.fileSize ?? 0;
    if (!size && Platform.OS !== 'web') {
      try {
        const info = await FileSystem.getInfoAsync(a.uri);
        if (info.exists && !info.isDirectory) size = (info as { size?: number }).size ?? 0;
      } catch {}
    }
    if (size > MAX_MEDIA_BYTES) return { ok: false, reason: 'too_large' };
    const base64 = await uriToBase64(a.uri);
    const realSize = size || approxBase64Bytes(base64);
    if (realSize > MAX_MEDIA_BYTES) return { ok: false, reason: 'too_large' };
    return {
      ok: true,
      data: {
        base64,
        mimeType: a.mimeType ?? 'video/mp4',
        fileName: a.fileName ?? `video_${Date.now()}.mp4`,
        fileSize: realSize,
        kind: 'video',
      },
    };
  } catch {
    return { ok: false, reason: 'error' };
  } finally {
    await deleteSourceFile(srcUri);
  }
}

export async function pickDocument(): Promise<PickResult> {
  let srcUri: string | undefined;
  try {
    const res = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      base64: true,
    });
    if (res.canceled || !res.assets?.length) return { ok: false, reason: 'cancelled' };
    const a = res.assets[0];
    srcUri = a.uri;
    const size = a.size ?? 0;
    if (size > MAX_MEDIA_BYTES) return { ok: false, reason: 'too_large' };
    const base64 = (a as { base64?: string | null }).base64 ?? (await uriToBase64(a.uri));
    const realSize = size || approxBase64Bytes(base64);
    if (realSize > MAX_MEDIA_BYTES) return { ok: false, reason: 'too_large' };
    return {
      ok: true,
      data: {
        base64,
        mimeType: a.mimeType ?? 'application/octet-stream',
        fileName: a.name ?? `file_${Date.now()}`,
        fileSize: realSize,
        kind: 'file',
      },
    };
  } catch {
    return { ok: false, reason: 'error' };
  } finally {
    await deleteSourceFile(srcUri);
  }
}

// ---------- Persist / read encrypted blobs ----------

export async function saveEncryptedMedia(
  id: string,
  base64: string,
  key: string,
  scope: MediaScope = 'real',
): Promise<string> {
  // Yield to the event loop BEFORE CryptoJS runs so React can commit the
  // "busy / loading" state update and show the spinner to the user.
  // Without this yield, CryptoJS blocks the JS thread immediately and the
  // spinner never appears — the UI looks frozen the whole time.
  await new Promise<void>(r => setTimeout(r, 0));

  const payload = encryptPayload(base64, key);

  if (Platform.OS === 'web') {
    const refKey = webPrefixFor(scope) + id;
    localStorage.setItem(refKey, payload);
    return refKey;
  }
  const dir = mediaDirFor(scope);
  await ensureDir(dir);
  const ref = `${dir}${id}.enc`;
  await FileSystem.writeAsStringAsync(ref, payload, { encoding: FileSystem.EncodingType.UTF8 });
  return ref;
}

export async function readMediaBase64(ref: string, key: string): Promise<string> {
  let stored = '';
  if (Platform.OS === 'web') {
    stored = localStorage.getItem(ref) ?? '';
  } else {
    stored = await FileSystem.readAsStringAsync(ref, { encoding: FileSystem.EncodingType.UTF8 });
  }
  if (!stored) throw new Error('missing');
  return decryptPayload(stored, key);
}

// Decrypted image data URI, memoized so grid/preview renders don't re-decrypt.
export async function getImagePreview(ref: string, mimeType: string, key: string): Promise<string> {
  const cached = previewCache.get(ref);
  if (cached) return cached;
  const epoch = sessionEpoch;
  const b64 = await readMediaBase64(ref, key);
  // If the session was wiped mid-decrypt, refuse to hand plaintext back to the UI.
  if (epoch !== sessionEpoch) throw new Error('cancelled');
  const uri = `data:${mimeType};base64,${b64}`;
  previewCache.set(ref, uri);
  return uri;
}

// Decrypt to a temporary plaintext file (native) or data URI (web) for playback
// or sharing. Native temp files live in the cache dir and are wiped on lock.
export async function prepareTempFile(
  ref: string,
  fileName: string,
  mimeType: string,
  key: string,
): Promise<string> {
  const epoch = sessionEpoch;
  const base64 = await readMediaBase64(ref, key);
  if (Platform.OS === 'web') {
    // Refuse to hand plaintext back if the session was wiped mid-decrypt.
    if (epoch !== sessionEpoch) throw new Error('cancelled');
    return `data:${mimeType};base64,${base64}`;
  }
  await ensureDir(TMP_DIR);
  const uri = `${TMP_DIR}${Date.now()}_${sanitizeName(fileName)}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  // If the session was wiped while decrypting, remove the just-written plaintext.
  if (epoch !== sessionEpoch) {
    await deleteTempFile(uri);
    throw new Error('cancelled');
  }
  return uri;
}

// ---------- Sharing / export ----------

export async function exportEncryptedMedia(ref: string, fileName: string): Promise<void> {
  if (Platform.OS === 'web') throw new Error('unsupported');
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error('unavailable');
  // Shares the raw .enc ciphertext file — the exported copy stays encrypted.
  await Sharing.shareAsync(ref, { dialogTitle: `${fileName} (encrypted)` });
}

export async function shareMediaSecurely(
  ref: string,
  fileName: string,
  mimeType: string,
  key: string,
): Promise<void> {
  if (Platform.OS === 'web') throw new Error('unsupported');
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error('unavailable');
  const tmp = await prepareTempFile(ref, fileName, mimeType, key);
  try {
    await Sharing.shareAsync(tmp, { mimeType, dialogTitle: fileName });
  } finally {
    await deleteTempFile(tmp);
  }
}

// ---------- Cleanup ----------

// Permanently delete the encrypted blob for a media item. Errors are allowed to
// propagate so callers can tell the user the delete failed instead of silently
// leaving orphaned ciphertext behind. `idempotent` means an already-missing file
// is treated as success (the blob is gone either way).
export async function deleteEncryptedMedia(ref: string): Promise<void> {
  previewCache.delete(ref);
  if (Platform.OS === 'web') {
    localStorage.removeItem(ref);
    return;
  }
  await FileSystem.deleteAsync(ref, { idempotent: true });
}

async function deleteTempFile(uri: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {}
}

// Delete the plaintext source copy a picker leaves behind in the cache dir
// (ImagePicker temp copy / DocumentPicker copyToCacheDirectory) once we have
// read its bytes into memory. Prevents plaintext lingering after an import.
// Restricted to the app cache dir so we never delete a provider/original file
// if a picker ever hands back a non-cache file:// path.
async function deleteSourceFile(uri?: string): Promise<void> {
  if (!uri || Platform.OS === 'web') return;
  const cache = FileSystem.cacheDirectory;
  if (!cache || !uri.startsWith(cache)) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {}
}

// Wipe only the decrypted plaintext temp files (keeps the in-memory image
// preview cache). Call when a viewer/share flow finishes.
export async function clearMediaTemp(): Promise<void> {
  if (Platform.OS === 'web' || !TMP_DIR) return;
  try {
    const info = await FileSystem.getInfoAsync(TMP_DIR);
    if (info.exists) await FileSystem.deleteAsync(TMP_DIR, { idempotent: true });
  } catch {}
}

// Wipe all decrypted plaintext temp files AND the in-memory preview cache.
// Call on lock, logout, and decoy-mode transitions. Bumps the session epoch
// first so any decrypt already in flight won't repopulate cache/temp afterward.
export async function clearMediaSession(): Promise<void> {
  sessionEpoch += 1;
  previewCache.clear();
  await clearMediaTemp();
}

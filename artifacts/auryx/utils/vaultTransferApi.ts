/**
 * vaultTransferApi.ts
 *
 * Client-side API calls for the key-management / vault-transfer layer.
 * All requests go to the shared API server at /api/keys/* and /api/vault/*.
 */

import { getSecureApiBase } from './apiBase';
import { authenticatedFetch } from './authenticatedFetch';

type AnyJson = Record<string, unknown>;

async function safeJson(res: Response): Promise<AnyJson> {
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`الخادم أرجع استجابة غير متوقعة (${res.status}) — ${text.slice(0, 120)}`);
  }
  return (await res.json()) as AnyJson;
}

async function apiPost(path: string, body: object): Promise<AnyJson> {
  const res = await authenticatedFetch(`${getSecureApiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await safeJson(res);
  if (!res.ok) throw new Error(String(json.message ?? json.error ?? `HTTP ${res.status}`));
  return json;
}

async function apiGet(path: string): Promise<AnyJson | null> {
  const res = await authenticatedFetch(`${getSecureApiBase()}${path}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const j = await res.json().catch(() => ({})) as AnyJson;
      throw new Error(String(j.message ?? j.error ?? `HTTP ${res.status}`));
    }
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as AnyJson;
}

// ── Public key registry ───────────────────────────────────────────────────────

/**
 * Upload this device's RSA public key JWK to the server so other users
 * (owners) can encrypt vault transfer keys to this device.
 */
export async function registerPublicKey(
  email: string,
  publicKeyJwk: JsonWebKey,
): Promise<void> {
  await apiPost('/api/keys/register', { email, publicKeyJwk });
}

/**
 * Fetch the RSA public key JWK for a given email, or null if not registered.
 */
export async function fetchPublicKey(email: string): Promise<JsonWebKey | null> {
  const result = await apiGet(`/api/keys/${encodeURIComponent(email)}`);
  if (!result) return null;
  return (result.publicKeyJwk as JsonWebKey) ?? null;
}

// ── Sealed vault ──────────────────────────────────────────────────────────────

export interface GuardianPackagePayload {
  email: string;
  /** Base-64 RSA-encrypted Shamir share hex */
  encryptedShare: string;
}

export interface SealParams {
  ownerEmail: string;
  beneficiaryEmail: string;
  /** CryptoJS AES-encrypted vault snapshot */
  encryptedBlob: string;
  /** Base-64 RSA-encrypted TK for the beneficiary (optional) */
  benefEncryptedKey?: string;
  /** One entry per guardian */
  guardianPackages: GuardianPackagePayload[];
  /** Shamir threshold k */
  threshold: number;
}

/** Upload a newly sealed vault package to the server. */
export async function sealVaultOnServer(params: SealParams): Promise<void> {
  await apiPost('/api/vault/seal', params);
}

export interface VaultPackage {
  encryptedBlob: string;
  beneficiaryEmail: string;
  benefEncryptedKey?: string;
  guardianPackages: GuardianPackagePayload[];
  threshold: number;
  sealedAt: number;
}

/** Retrieve the sealed vault package for a given owner. */
export async function fetchVaultPackage(ownerEmail: string): Promise<VaultPackage | null> {
  const result = await apiGet(`/api/vault/${encodeURIComponent(ownerEmail)}`);
  if (!result) return null;
  return result as unknown as VaultPackage;
}

// ── Guardian votes ────────────────────────────────────────────────────────────

/**
 * A guardian submits a beneficiary-encrypted Shamir share. The server never
 * receives the raw share and cannot decrypt it.
 */
export async function submitGuardianShareToServer(
  ownerEmail: string,
  guardianEmail: string,
  encryptedShareForBeneficiary: string,
): Promise<void> {
  await apiPost(`/api/vault/share/${encodeURIComponent(ownerEmail)}`, {
    guardianEmail,
    encryptedShareForBeneficiary,
  });
}

export interface CollectedSharesResult {
  encryptedShares: string[];
  threshold: number;
}

/** Beneficiary calls this to retrieve submitted guardian shares. */
export async function fetchCollectedShares(
  ownerEmail: string,
): Promise<CollectedSharesResult | null> {
  const result = await apiGet(`/api/vault/shares/${encodeURIComponent(ownerEmail)}`);
  if (!result) return null;
  return result as unknown as CollectedSharesResult;
}

/** Check whether a given user has registered their RSA public key. */
export async function checkKeyRegistered(email: string): Promise<boolean> {
  const key = await fetchPublicKey(email);
  return key !== null;
}

// ── Absence protocol ──────────────────────────────────────────────────────────

export interface AbsenceInitiateResult {
  requestId: number;
  status: string;
  requestedAt: number;
  ownerNotifCount: number;
}

/**
 * Initiate the absence protocol for a given owner.
 * Notifies the owner immediately and starts the 48-h server-side countdown.
 */
export async function initiateAbsenceProtocol(
  ownerEmail: string,
  beneficiaryName: string,
  ownerName: string,
): Promise<AbsenceInitiateResult> {
  const result = await apiPost('/api/absence/initiate', {
    ownerEmail,
    beneficiaryName,
    ownerName,
  });
  return result as unknown as AbsenceInitiateResult;
}

export interface AbsenceStatusResult {
  requestId: number;
  status: string;   // pending_owner | cancelled_by_owner | pending_guardian_vote | guardian_approved | guardian_rejected
  ownerNotifCount: number;
  requestedAt: number;
  guardianVoteStartedAt: number | null;
  completedAt: number | null;
}

/**
 * Poll the absence protocol status for a given owner.
 * Returns null if no request exists (status = 'none').
 */
export async function fetchAbsenceStatus(ownerEmail: string): Promise<AbsenceStatusResult | null> {
  const result = await apiGet(`/api/absence/status/${encodeURIComponent(ownerEmail)}`);
  if (!result) return null;
  if ((result as { status?: unknown }).status === 'none') return null;
  return result as unknown as AbsenceStatusResult;
}

/**
 * Owner cancels the active absence request from the app.
 */
export async function cancelAbsenceProtocol(ownerEmail: string): Promise<void> {
  await apiPost('/api/absence/cancel', { ownerEmail });
}

// ── OTP vault access ──────────────────────────────────────────────────────────

/**
 * Ask the server to generate a 6-digit OTP and email it to the beneficiary.
 * ownerName is used only for the email body.
 */
export async function requestVaultOtp(
  ownerEmail: string,
  beneficiaryEmail: string,
  ownerName: string,
): Promise<void> {
  await apiPost(`/api/vault/request-otp/${encodeURIComponent(ownerEmail)}`, {
    beneficiaryEmail,
    ownerName,
  });
}

export interface OtpVerifySuccess {
  valid: true;
  encryptedBlob: string;
  benefEncryptedKey?: string;
  ownerName: string;
  sealedAt: number;
}

export interface OtpVerifyFail {
  valid: false;
  reason: string;
}

export type OtpVerifyResult = OtpVerifySuccess | OtpVerifyFail;

/**
 * Verify a 6-digit OTP and, if valid, receive the encrypted vault package
 * (blob + RSA-encrypted transfer key for the beneficiary).
 */
export async function verifyVaultOtp(
  ownerEmail: string,
  beneficiaryEmail: string,
  otp: string,
): Promise<OtpVerifyResult> {
  try {
    const result = await apiPost(`/api/vault/verify-otp/${encodeURIComponent(ownerEmail)}`, {
      beneficiaryEmail,
      otp,
    });
    return result as unknown as OtpVerifyResult;
  } catch (err) {
    return { valid: false, reason: String(err instanceof Error ? err.message : err) };
  }
}

/**
 * Email API client.
 * Sends requests to the Express API server (/api/email/*, /api/recovery-email/*, etc.) 
 * which relays them through SMTP/Resend via nodemailer.
 */
import { getApiBase } from './apiBase';
import { authenticatedFetch } from './authenticatedFetch';

type ApiResult = { success: boolean; token?: string; error?: string };

const EMAIL_TIMEOUT_MS = 25_000;
const MAX_RETRIES = 3;

async function postOnce(path: string, body: object): Promise<ApiResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);
  try {
    const res = await authenticatedFetch(`${getApiBase()}/api/email${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      const serverMsg = String(err.message ?? err.error ?? `HTTP ${res.status}`);
      return { success: false, error: serverMsg };
    }
    return (await res.json()) as ApiResult;
  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? 'Network error';
    if (msg.includes('aborted')) return { success: false, error: 'انتهت مهلة الطلب (25 ث) — تحقق من الاتصال' };
    if (msg.includes('Network') || msg.includes('fetch')) return { success: false, error: 'تعذّر الاتصال بالخادم — تحقق من الاتصال بالإنترنت' };
    return { success: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function post(path: string, body: object): Promise<ApiResult> {
  let lastErr = 'خطأ غير معروف';
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
    const result = await postOnce(path, body);
    if (result.success) return result;
    lastErr = result.error ?? lastErr;
    const isRetryable =
      lastErr.includes('الاتصال') ||
      lastErr.includes('Network') ||
      lastErr.includes('fetch') ||
      lastErr.includes('انتهت مهلة');
    if (!isRetryable) return result;
  }
  return { success: false, error: `${lastErr} (بعد ${MAX_RETRIES} محاولات)` };
}

// ── Guardian ──────────────────────────────────────────────────────────────────

export async function inviteGuardian(
  ownerEmail: string, ownerName: string, guardianName: string, guardianEmail: string,
): Promise<ApiResult> {
  return post('/invite-guardian', { ownerEmail, ownerName, guardianName, guardianEmail });
}

export async function notifyGuardianRemoved(
  ownerEmail: string, ownerName: string, guardianEmail: string,
): Promise<ApiResult> {
  return post('/remove-guardian', { ownerEmail, ownerName, guardianEmail });
}

// ── Beneficiary ───────────────────────────────────────────────────────────────

export async function inviteBeneficiary(
  ownerEmail: string, ownerName: string, beneficiaryName: string, beneficiaryEmail: string, relationship: string,
): Promise<ApiResult> {
  return post('/invite-beneficiary', { ownerEmail, ownerName, beneficiaryName, beneficiaryEmail, relationship });
}

export async function notifyBeneficiaryRemoved(
  ownerEmail: string, ownerName: string, beneficiaryEmail: string,
): Promise<ApiResult> {
  return post('/remove-beneficiary', { ownerEmail, ownerName, beneficiaryEmail });
}

// ── Emergency Protocol ────────────────────────────────────────────────────────

export async function triggerEmergencyEmail(
  ownerEmail: string, ownerName: string, beneficiaryName: string, beneficiaryRelation: string, guardianEmails: string[],
): Promise<ApiResult> {
  return post('/emergency', { ownerEmail, ownerName, beneficiaryName, beneficiaryRelation, guardianEmails });
}

export async function triggerVoteRequest(
  ownerEmail: string, ownerName: string, guardianEmails: string[],
): Promise<ApiResult> {
  return post('/vote-request', { ownerEmail, ownerName, guardianEmails });
}

export async function notifyOwner(
  ownerEmail: string, ownerName: string, beneficiaryName: string, notifCount: number,
): Promise<ApiResult> {
  return post('/notify-owner', { ownerEmail, ownerName, beneficiaryName, notifCount });
}

// ── Absence protocol (server-side) ─────────────────────────────────────────────

export async function initiateServerAbsenceProtocol(
  ownerEmail: string, beneficiaryName: string, ownerName: string,
): Promise<{ success: boolean; requestId?: number; status?: string; requestedAt?: number; ownerNotifCount?: number; error?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), EMAIL_TIMEOUT_MS);
  try {
    const res = await authenticatedFetch(`${getApiBase()}/api/absence/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerEmail, beneficiaryName, ownerName }),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) return { success: false, error: String(json.message ?? json.error ?? `HTTP ${res.status}`) };
    return {
      success: true,
      requestId: json.requestId as number,
      status: json.status as string,
      requestedAt: json.requestedAt as number | undefined,
      ownerNotifCount: json.ownerNotifCount as number | undefined,
    };
  } catch (e: unknown) {
    return { success: false, error: (e as Error)?.message ?? 'Network error' };
  } finally {
    clearTimeout(t);
  }
}

export async function fetchServerAbsenceStatus(
  ownerEmail: string,
): Promise<{ status: string; ownerNotifCount: number; requestedAt?: number; guardianVoteStartedAt?: number | null } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await authenticatedFetch(`${getApiBase()}/api/absence/status/${encodeURIComponent(ownerEmail)}`, { signal: ctrl.signal });
    if (res.status === 404) return null;
    const json = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!json) return null;
    return {
      status: String(json.status ?? 'none'),
      ownerNotifCount: Number(json.ownerNotifCount ?? 0),
      requestedAt: json.requestedAt as number | undefined,
      guardianVoteStartedAt: json.guardianVoteStartedAt as number | null | undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function confirmAndStartGuardianVote(
  ownerEmail: string,
): Promise<{ success: boolean; guardianCount?: number; error?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), EMAIL_TIMEOUT_MS);
  try {
    const res = await authenticatedFetch(`${getApiBase()}/api/absence/beneficiary-confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerEmail }),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) return { success: false, error: String(json.message ?? json.error ?? `HTTP ${res.status}`) };
    return { success: true, guardianCount: json.guardianCount as number };
  } catch (e: unknown) {
    return { success: false, error: (e as Error)?.message ?? 'Network error' };
  } finally {
    clearTimeout(t);
  }
}

export async function triggerStartVote(
  ownerEmail: string, beneficiaryName: string, beneficiaryEmail: string,
): Promise<{ success: boolean; guardianCount?: number; error?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), EMAIL_TIMEOUT_MS);
  try {
    const res = await authenticatedFetch(`${getApiBase()}/api/absence/start-vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerEmail, beneficiaryName, beneficiaryEmail }),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) return { success: false, error: String(json.message ?? json.error ?? `HTTP ${res.status}`) };
    return { success: true, guardianCount: json.guardianCount as number };
  } catch (e: unknown) {
    return { success: false, error: (e as Error)?.message ?? 'Network error' };
  } finally {
    clearTimeout(t);
  }
}

export interface GuardianVoteDecision {
  guardianEmail: string;
  decision: 'approve' | 'reject' | null;
  decidedAt: number | null;
}

export interface GuardianVoteStatus {
  requestId: number;
  status: string;
  threshold: number;
  approvals: number;
  rejections: number;
  quorumReached: boolean;
  beneficiaryEmail?: string;
  decisions: GuardianVoteDecision[];
}

export async function fetchGuardianVoteStatus(
  ownerEmail: string,
): Promise<GuardianVoteStatus | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await authenticatedFetch(`${getApiBase()}/api/absence/vote-status/${encodeURIComponent(ownerEmail)}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as GuardianVoteStatus;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function checkInviteStatus(
  token: string,
): Promise<{ status: 'pending' | 'accepted' | 'rejected' | 'expired' }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await authenticatedFetch(`${getApiBase()}/api/invite/status/${token}`, { signal: ctrl.signal });
    if (!res.ok) return { status: 'expired' };
    return (await res.json()) as { status: 'pending' | 'accepted' | 'rejected' | 'expired' };
  } catch {
    return { status: 'expired' };
  } finally {
    clearTimeout(t);
  }
}

// ── PIN Reset via Guardians ────────────────────────────────────────────────────

export interface PinResetStatus {
  requestId: number;
  status: 'pending_guardian_vote' | 'approved' | 'rejected' | 'expired' | 'completed' | 'none';
  threshold: number;
  approvals: number;
  rejections: number;
  quorumReached: boolean;
  otpSent: boolean;
  expiresAt: number | null;
  decisions: GuardianVoteDecision[];
}

export async function initiatePinResetRequest(
  ownerEmail: string, ownerName: string,
): Promise<{ success: boolean; requestId?: number; guardianCount?: number; error?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), EMAIL_TIMEOUT_MS);
  try {
    const res = await authenticatedFetch(`${getApiBase()}/api/pin-reset/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerEmail, ownerName }),
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { success: false, error: String(json.message ?? json.error ?? `HTTP ${res.status}`) };
    return { success: true, requestId: json.requestId as number | undefined, guardianCount: json.guardianCount as number | undefined };
  } catch (e: unknown) {
    return { success: false, error: (e as Error)?.message ?? 'Network error' };
  } finally {
    clearTimeout(t);
  }
}

export async function fetchPinResetStatus(
  ownerEmail: string,
): Promise<PinResetStatus | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await authenticatedFetch(`${getApiBase()}/api/pin-reset/status/${encodeURIComponent(ownerEmail)}`, { signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as PinResetStatus;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function verifyPinResetOtp(
  ownerEmail: string, code: string,
): Promise<{ success: boolean; resetToken?: string; error?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), EMAIL_TIMEOUT_MS);
  try {
    const res = await authenticatedFetch(`${getApiBase()}/api/pin-reset/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerEmail, code }),
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { success: false, error: String(json.message ?? json.error ?? `HTTP ${res.status}`) };
    return { success: true, resetToken: json.resetToken as string | undefined };
  } catch (e: unknown) {
    return { success: false, error: (e as Error)?.message ?? 'Network error' };
  } finally {
    clearTimeout(t);
  }
}

export async function completePinReset(
  ownerEmail: string, resetToken: string,
): Promise<{ success: boolean; error?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), EMAIL_TIMEOUT_MS);
  try {
    const res = await authenticatedFetch(`${getApiBase()}/api/pin-reset/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerEmail, resetToken }),
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { success: false, error: String(json.message ?? json.error ?? `HTTP ${res.status}`) };
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: (e as Error)?.message ?? 'Network error' };
  } finally {
    clearTimeout(t);
  }
}

// ── Recovery Email (PIN Reset Alternative) WITH DIAGNOSTICS ───────────────────

/** Set or update the recovery email. Triggers an OTP to be sent to that email. */
export async function setRecoveryEmail(
  email: string,
): Promise<{ success: boolean; error?: string }> {
  const apiUrl = `${getApiBase()}/api/recovery-email/set`;
  console.log('[DIAGNOSTIC][RecoveryEmail] Attempting to set recovery email. URL:', apiUrl);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), EMAIL_TIMEOUT_MS);

  try {
    const res = await authenticatedFetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      signal: ctrl.signal,
    });

    console.log('[DIAGNOSTIC][RecoveryEmail] Response status:', res.status);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('[DIAGNOSTIC][RecoveryEmail] Server error response:', errorText);
      return { success: false, error: `HTTP ${res.status}: ${errorText}` };
    }

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    console.log('[DIAGNOSTIC][RecoveryEmail] Success response:', json);
    return { success: true };
  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? 'Network error';
    console.error('[DIAGNOSTIC][RecoveryEmail] Network/Fetch error:', msg);
    return { success: false, error: msg };
  } finally {
    clearTimeout(t);
  }
}

/** Verify the OTP sent to the recovery email. Returns a short-lived recoveryToken. */
export async function verifyRecoveryOtp(
  email: string, otp: string,
): Promise<{ success: boolean; recoveryToken?: string; error?: string }> {
  const apiUrl = `${getApiBase()}/api/recovery-email/verify`;
  console.log('[DIAGNOSTIC][RecoveryEmail] Attempting to verify OTP. URL:', apiUrl);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), EMAIL_TIMEOUT_MS);

  try {
    const res = await authenticatedFetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp }),
      signal: ctrl.signal,
    });

    console.log('[DIAGNOSTIC][RecoveryEmail] Response status:', res.status);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('[DIAGNOSTIC][RecoveryEmail] Server error response:', errorText);
      return { success: false, error: `HTTP ${res.status}: ${errorText}` };
    }

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    console.log('[DIAGNOSTIC][RecoveryEmail] Success response:', json);
    return { success: true, recoveryToken: json.recoveryToken as string | undefined };
  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? 'Network error';
    console.error('[DIAGNOSTIC][RecoveryEmail] Network/Fetch error:', msg);
    return { success: false, error: msg };
  } finally {
    clearTimeout(t);
  }
}

/** Mark the recovery process as complete (consumes the recoveryToken). */
export async function completeRecovery(
  recoveryToken: string,
): Promise<{ success: boolean; error?: string }> {
  const apiUrl = `${getApiBase()}/api/recovery-email/complete`;
  console.log('[DIAGNOSTIC][RecoveryEmail] Attempting to complete recovery. URL:', apiUrl);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), EMAIL_TIMEOUT_MS);

  try {
    const res = await authenticatedFetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recoveryToken }),
      signal: ctrl.signal,
    });

    console.log('[DIAGNOSTIC][RecoveryEmail] Response status:', res.status);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('[DIAGNOSTIC][RecoveryEmail] Server error response:', errorText);
      return { success: false, error: `HTTP ${res.status}: ${errorText}` };
    }

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    console.log('[DIAGNOSTIC][RecoveryEmail] Success response:', json);
    return { success: true };
  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? 'Network error';
    console.error('[DIAGNOSTIC][RecoveryEmail] Network/Fetch error:', msg);
    return { success: false, error: msg };
  } finally {
    clearTimeout(t);
  }
}
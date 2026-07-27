/**
 * Email API client.
 * Sends requests to the Express API server (/api/email/*) which relays them
 * through SMTP (smtp.gmail.com:587) via nodemailer.
 */
import { getApiBase } from './apiBase';

type ApiResult = { success: boolean; token?: string; error?: string };

const EMAIL_TIMEOUT_MS = 25_000;
const MAX_RETRIES = 3;

async function postOnce(path: string, body: object): Promise<ApiResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);
  try {
    const res = await fetch(`${getApiBase()}/api/email${path}`, {
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

/** Send an invitation email to a new guardian. Returns the invite token. */
export async function inviteGuardian(
  ownerName: string,
  guardianName: string,
  guardianEmail: string,
): Promise<ApiResult> {
  return post('/invite-guardian', { ownerName, guardianName, guardianEmail });
}

/** Notify a guardian that their role has been removed. */
export async function notifyGuardianRemoved(
  ownerName: string,
  guardianEmail: string,
): Promise<ApiResult> {
  return post('/remove-guardian', { ownerName, guardianEmail });
}

// ── Beneficiary ───────────────────────────────────────────────────────────────

/** Send an invitation email to the final beneficiary. Returns the invite token. */
export async function inviteBeneficiary(
  ownerName: string,
  beneficiaryName: string,
  beneficiaryEmail: string,
  relationship: string,
): Promise<ApiResult> {
  return post('/invite-beneficiary', { ownerName, beneficiaryName, beneficiaryEmail, relationship });
}

/** Notify the previous beneficiary that their role has been removed. */
export async function notifyBeneficiaryRemoved(
  ownerName: string,
  beneficiaryEmail: string,
): Promise<ApiResult> {
  return post('/remove-beneficiary', { ownerName, beneficiaryEmail });
}

// ── Emergency Protocol ────────────────────────────────────────────────────────

/** Notify all guardians that the emergency protocol has been triggered. */
export async function triggerEmergencyEmail(
  ownerName: string,
  beneficiaryName: string,
  beneficiaryRelation: string,
  guardianEmails: string[],
): Promise<ApiResult> {
  return post('/emergency', { ownerName, beneficiaryName, beneficiaryRelation, guardianEmails });
}

/** Send the 48-hour vote request to all guardians. */
export async function triggerVoteRequest(
  ownerName: string,
  guardianEmails: string[],
): Promise<ApiResult> {
  return post('/vote-request', { ownerName, guardianEmails });
}

// ── Owner notification (every 3h during 48h wait) ─────────────────────────────

/** Notify the vault owner that their beneficiary has triggered emergency access. */
export async function notifyOwner(
  ownerEmail: string,
  ownerName: string,
  beneficiaryName: string,
  notifCount: number,
): Promise<ApiResult> {
  return post('/notify-owner', { ownerEmail, ownerName, beneficiaryName, notifCount });
}

// ── Absence protocol (server-side) ─────────────────────────────────────────────

/**
 * Start the server-side absence protocol.
 * The server will handle all 3-hourly owner reminders and guardian voting
 * — even when the app is closed.
 */
export async function initiateServerAbsenceProtocol(
  ownerEmail: string,
  beneficiaryName: string,
  ownerName: string,
): Promise<{
  success: boolean;
  requestId?: number;
  status?: string;
  requestedAt?: number;
  ownerNotifCount?: number;
  error?: string;
}> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), EMAIL_TIMEOUT_MS);
  try {
    const res = await fetch(`${getApiBase()}/api/absence/initiate`, {
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

/** Poll the absence protocol status for an owner. */
export async function fetchServerAbsenceStatus(
  ownerEmail: string,
): Promise<{ status: string; ownerNotifCount: number; requestedAt?: number; guardianVoteStartedAt?: number | null } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${getApiBase()}/api/absence/status/${encodeURIComponent(ownerEmail)}`, {
      signal: ctrl.signal,
    });
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

// ── Absence: formal guardian vote (with individual token links) ───────────────

/**
 * Called by the beneficiary after the 48h owner-absent confirmation.
 * Triggers guardian vote emails from the server.
 */
export async function confirmAndStartGuardianVote(
  ownerEmail: string,
): Promise<{ success: boolean; guardianCount?: number; error?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), EMAIL_TIMEOUT_MS);
  try {
    const res = await fetch(`${getApiBase()}/api/absence/beneficiary-confirm`, {
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

/**
 * Starts the formal guardian voting phase on the server.
 * The server creates per-guardian decision tokens and sends
 * individual approve/reject email links to each guardian.
 */
export async function triggerStartVote(
  ownerEmail: string,
  beneficiaryName: string,
  beneficiaryEmail: string,
): Promise<{ success: boolean; guardianCount?: number; error?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), EMAIL_TIMEOUT_MS);
  try {
    const res = await fetch(`${getApiBase()}/api/absence/start-vote`, {
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

/** Poll per-guardian vote status from the server. */
export async function fetchGuardianVoteStatus(
  ownerEmail: string,
): Promise<GuardianVoteStatus | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${getApiBase()}/api/absence/vote-status/${encodeURIComponent(ownerEmail)}`, {
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as GuardianVoteStatus;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── Token status ──────────────────────────────────────────────────────────────

/** Poll the API to check if an invite token has been accepted/rejected. */
export async function checkInviteStatus(
  token: string,
): Promise<{ status: 'pending' | 'accepted' | 'rejected' | 'expired' }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${getApiBase()}/api/invite/status/${token}`, { signal: ctrl.signal });
    if (!res.ok) return { status: 'expired' };
    return (await res.json()) as { status: 'pending' | 'accepted' | 'rejected' | 'expired' };
  } catch {
    return { status: 'expired' };
  } finally {
    clearTimeout(t);
  }
}

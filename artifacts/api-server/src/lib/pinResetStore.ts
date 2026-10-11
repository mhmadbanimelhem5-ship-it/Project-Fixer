/**
 * pinResetStore.ts — PostgreSQL-backed store for PIN reset via guardian quorum.
 *
 * Reuses the same tables as absence protocol:
 *   absence_requests         — one row per PIN-reset request
 *   absence_guardian_decisions — one row per guardian per request (vote token + result)
 *
 * Distinguishes PIN-reset from absence by setting beneficiaryEmail = '' (empty string).
 */

import crypto from 'crypto';
import { db } from '@workspace/db';
import {
  absenceRequestsTable,
  absenceGuardianDecisionsTable,
} from '@workspace/db';
import { eq, and, or, desc } from 'drizzle-orm';

export type PinResetStatus =
  | 'pending_guardian_vote'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'completed';

export interface PinResetRequest {
  id: number;
  ownerEmail: string;
  ownerName: string;
  requestedAt: number;
  status: PinResetStatus;
  expiresAt: number;
  guardianVoteStartedAt: number | null;
  completedAt: number | null;
}

const PIN_RESET_EXPIRY_MS = 72 * 60 * 60 * 1000; // 72 hours

// ── Create / lookup ───────────────────────────────────────────────────────────

/**
 * Create a new PIN-reset request, or return the existing active one if it exists.
 * beneficiaryEmail is set to '' (empty string) to distinguish from absence requests.
 */
export async function createOrReusePinResetRequest(
  ownerEmail: string,
  ownerName: string,
): Promise<PinResetRequest> {
  const oKey = ownerEmail.toLowerCase();

  // Reuse any existing non-terminal request to prevent duplicate active requests.
  const existing = await db
    .select()
    .from(absenceRequestsTable)
    .where(
      and(
        eq(absenceRequestsTable.ownerEmail, oKey),
        eq(absenceRequestsTable.beneficiaryEmail, ''), // PIN-reset marker
        or(
          eq(absenceRequestsTable.status, 'pending_guardian_vote'),
          eq(absenceRequestsTable.status, 'pending_owner'), // fallback for edge cases
        ),
      ),
    )
    .orderBy(desc(absenceRequestsTable.requestedAt))
    .limit(1);

  if (existing[0]) return existing[0] as unknown as PinResetRequest;

  const now = Date.now();
  const expiresAt = now + PIN_RESET_EXPIRY_MS;
  const rows = await db
    .insert(absenceRequestsTable)
    .values({
      ownerEmail: oKey,
      beneficiaryEmail: '', // PIN-reset marker
      beneficiaryName: '',
      ownerName,
      requestedAt: now,
      status: 'pending_guardian_vote',
      ownerNotifCount: 0,
      ownerAliveToken: null,
    })
    .returning();

  return {
    ...(rows[0] as unknown as PinResetRequest),
    expiresAt,
  };
}

/** Fetch the most recent PIN-reset request for an owner. */
export async function getLatestPinResetRequest(ownerEmail: string): Promise<PinResetRequest | null> {
  const rows = await db
    .select()
    .from(absenceRequestsTable)
    .where(
      and(
        eq(absenceRequestsTable.ownerEmail, ownerEmail.toLowerCase()),
        eq(absenceRequestsTable.beneficiaryEmail, ''), // PIN-reset marker
      ),
    )
    .orderBy(desc(absenceRequestsTable.requestedAt))
    .limit(1);

  if (!rows[0]) return null;

  const req = rows[0] as unknown as PinResetRequest;
  return {
    ...req,
    expiresAt: req.requestedAt + PIN_RESET_EXPIRY_MS,
  };
}

// ── State transitions ─────────────────────────────────────────────────────────

/** Transition to guardian voting phase (idempotent). */
export async function startGuardianVote(requestId: number): Promise<void> {
  await db
    .update(absenceRequestsTable)
    .set({ status: 'pending_guardian_vote', guardianVoteStartedAt: Date.now() })
    .where(eq(absenceRequestsTable.id, requestId));
}

/** Mark request completed (approved or rejected). */
export async function completePinResetRequest(
  requestId: number,
  outcome: 'approved' | 'rejected' | 'expired' | 'completed',
): Promise<void> {
  await db
    .update(absenceRequestsTable)
    .set({ status: outcome, completedAt: Date.now() })
    .where(eq(absenceRequestsTable.id, requestId));
}

// ── Guardian decisions ────────────────────────────────────────────────────────

/** Store guardian vote tokens before sending emails. */
export async function createGuardianDecisionSlots(
  requestId: number,
  guardianEmails: string[],
): Promise<Map<string, string>> {
  const tokenMap = new Map<string, string>();

  for (const email of guardianEmails) {
    const token = crypto.randomBytes(32).toString('hex');
    tokenMap.set(email.toLowerCase(), token);

    await db
      .insert(absenceGuardianDecisionsTable)
      .values({
        requestId,
        guardianEmail: email.toLowerCase(),
        voteToken: token,
        decision: null,
        decidedAt: null,
      })
      .onConflictDoNothing();
  }

  return tokenMap;
}

/** Find a guardian decision slot by vote token. */
export async function getDecisionByToken(token: string): Promise<{
  requestId: number;
  guardianEmail: string;
  decision: string | null;
} | null> {
  const rows = await db
    .select()
    .from(absenceGuardianDecisionsTable)
    .where(eq(absenceGuardianDecisionsTable.voteToken, token))
    .limit(1);

  return rows[0]
    ? {
        requestId: rows[0].requestId,
        guardianEmail: rows[0].guardianEmail,
        decision: rows[0].decision,
      }
    : null;
}

/** Record a guardian's vote. */
export async function recordGuardianDecision(
  requestId: number,
  guardianEmail: string,
  decision: 'approve' | 'reject',
): Promise<void> {
  await db
    .update(absenceGuardianDecisionsTable)
    .set({ decision, decidedAt: Date.now() })
    .where(
      and(
        eq(absenceGuardianDecisionsTable.requestId, requestId),
        eq(absenceGuardianDecisionsTable.guardianEmail, guardianEmail.toLowerCase()),
      ),
    );
}

/** Fetch a single PIN-reset request by primary key. */
export async function getPinResetRequestById(id: number): Promise<PinResetRequest | null> {
  const rows = await db
    .select()
    .from(absenceRequestsTable)
    .where(eq(absenceRequestsTable.id, id))
    .limit(1);

  if (!rows[0]) return null;

  const req = rows[0] as unknown as PinResetRequest;
  return {
    ...req,
    expiresAt: req.requestedAt + PIN_RESET_EXPIRY_MS,
  };
}

/** Count how many guardians approved for a given request. */
export async function countApprovals(requestId: number): Promise<number> {
  const rows = await db
    .select()
    .from(absenceGuardianDecisionsTable)
    .where(
      and(
        eq(absenceGuardianDecisionsTable.requestId, requestId),
        eq(absenceGuardianDecisionsTable.decision, 'approve'),
      ),
    );

  return rows.length;
}

/** Fetch all guardian decisions for a request. */
export async function getGuardianDecisions(requestId: number): Promise<Array<{
  guardianEmail: string;
  decision: string | null;
  decidedAt: number | null;
}>> {
  const rows = await db
    .select()
    .from(absenceGuardianDecisionsTable)
    .where(eq(absenceGuardianDecisionsTable.requestId, requestId));

  return rows.map(r => ({
    guardianEmail: r.guardianEmail,
    decision: r.decision,
    decidedAt: r.decidedAt,
  }));
}
/**
 * absenceStore.ts — PostgreSQL-backed store for the absence protocol.
 *
 * Tables used:
 *   absence_requests         — one row per beneficiary unlock request
 *   absence_guardian_decisions — one row per guardian per request (vote token + result)
 */

import crypto from 'crypto';
import { db } from '@workspace/db';
import {
  absenceRequestsTable,
  absenceGuardianDecisionsTable,
} from '@workspace/db';
import { eq, and, or, desc } from 'drizzle-orm';

export type AbsenceStatus =
  | 'pending_owner'
  | 'cancelled_by_owner'
  | 'pending_beneficiary_confirmation'
  | 'pending_guardian_vote'
  | 'guardian_approved'
  | 'guardian_rejected'
  | 'expired';

export interface AbsenceRequest {
  id: number;
  ownerEmail: string;
  beneficiaryEmail: string;
  beneficiaryName: string;
  ownerName: string;
  requestedAt: number;
  status: AbsenceStatus;
  ownerLastNotifiedAt: number | null;
  ownerNotifCount: number;
  ownerAliveToken: string | null;
  guardianVoteStartedAt: number | null;
  completedAt: number | null;
}

// ── Create / lookup ───────────────────────────────────────────────────────────

/**
 * Create a new absence request, or return the existing active one if it exists.
 * Also generates a unique owner-alive token for the email "I'm OK" link.
 */
export async function createOrReuseAbsenceRequest(
  ownerEmail: string,
  beneficiaryEmail: string,
  beneficiaryName: string,
  ownerName: string,
): Promise<AbsenceRequest> {
  const oKey = ownerEmail.toLowerCase();

  // Reuse any existing non-terminal request (pending_owner, pending_beneficiary_confirmation,
  // or pending_guardian_vote) to prevent duplicate active requests.
  const existing = await db
    .select()
    .from(absenceRequestsTable)
    .where(
      and(
        eq(absenceRequestsTable.ownerEmail, oKey),
        or(
          eq(absenceRequestsTable.status, 'pending_owner'),
          eq(absenceRequestsTable.status, 'pending_beneficiary_confirmation'),
          eq(absenceRequestsTable.status, 'pending_guardian_vote'),
        ),
      ),
    )
    .orderBy(desc(absenceRequestsTable.requestedAt))
    .limit(1);

  if (existing[0]) return existing[0] as unknown as AbsenceRequest;

  const aliveToken = crypto.randomBytes(32).toString('hex');
  const rows = await db
    .insert(absenceRequestsTable)
    .values({
      ownerEmail: oKey,
      beneficiaryEmail: beneficiaryEmail.toLowerCase(),
      beneficiaryName,
      ownerName,
      requestedAt: Date.now(),
      status: 'pending_owner',
      ownerNotifCount: 0,
      ownerAliveToken: aliveToken,
    })
    .returning();

  return rows[0] as unknown as AbsenceRequest;
}

/** Fetch the most recent absence request for an owner. */
export async function getLatestAbsenceRequest(ownerEmail: string): Promise<AbsenceRequest | null> {
  const rows = await db
    .select()
    .from(absenceRequestsTable)
    .where(eq(absenceRequestsTable.ownerEmail, ownerEmail.toLowerCase()))
    .orderBy(desc(absenceRequestsTable.requestedAt))
    .limit(1);

  return (rows[0] as unknown as AbsenceRequest) ?? null;
}

/** Fetch all requests that still need scheduler attention. */
export async function getActiveRequests(): Promise<AbsenceRequest[]> {
  const rows = await db
    .select()
    .from(absenceRequestsTable)
    .where(
      or(
        eq(absenceRequestsTable.status, 'pending_owner'),
        eq(absenceRequestsTable.status, 'pending_guardian_vote'),
      ),
    );

  return rows as unknown as AbsenceRequest[];
}

/** Find a request by the owner-alive token (used in email link). */
export async function getRequestByAliveToken(token: string): Promise<AbsenceRequest | null> {
  const rows = await db
    .select()
    .from(absenceRequestsTable)
    .where(eq(absenceRequestsTable.ownerAliveToken, token))
    .limit(1);

  return (rows[0] as unknown as AbsenceRequest) ?? null;
}

// ── State transitions ─────────────────────────────────────────────────────────

/** Record a sent owner notification (increments count, updates timestamp). */
export async function recordOwnerNotification(requestId: number, newCount: number): Promise<void> {
  await db
    .update(absenceRequestsTable)
    .set({ ownerLastNotifiedAt: Date.now(), ownerNotifCount: newCount })
    .where(eq(absenceRequestsTable.id, requestId));
}

/** Owner confirms alive — cancels the protocol. Only transitions from cancellable statuses. */
export async function cancelAbsenceRequest(requestId: number): Promise<void> {
  await db
    .update(absenceRequestsTable)
    .set({ status: 'cancelled_by_owner', completedAt: Date.now() })
    .where(
      and(
        eq(absenceRequestsTable.id, requestId),
        or(
          eq(absenceRequestsTable.status, 'pending_owner'),
          eq(absenceRequestsTable.status, 'pending_beneficiary_confirmation'),
        ),
      ),
    );
}

/** Transition to guardian voting phase. Only from pending_owner or pending_beneficiary_confirmation. */
export async function startGuardianVote(requestId: number): Promise<void> {
  await db
    .update(absenceRequestsTable)
    .set({ status: 'pending_guardian_vote', guardianVoteStartedAt: Date.now() })
    .where(
      and(
        eq(absenceRequestsTable.id, requestId),
        or(
          eq(absenceRequestsTable.status, 'pending_owner'),
          eq(absenceRequestsTable.status, 'pending_beneficiary_confirmation'),
          eq(absenceRequestsTable.status, 'pending_guardian_vote'), // idempotent re-trigger
        ),
      ),
    );
}

/** Transition to pending_beneficiary_confirmation after 48h owner non-response.
 *  WHERE clause guards against double-execution in overlapping scheduler runs. */
export async function transitionToBeneficiaryConfirmation(requestId: number): Promise<void> {
  await db
    .update(absenceRequestsTable)
    .set({ status: 'pending_beneficiary_confirmation' })
    .where(
      and(
        eq(absenceRequestsTable.id, requestId),
        eq(absenceRequestsTable.status, 'pending_owner'),
      ),
    );
}

/** Mark request completed (approved or rejected). */
export async function completeAbsenceRequest(
  requestId: number,
  outcome: 'guardian_approved' | 'guardian_rejected',
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

/** Fetch a single absence request by primary key. */
export async function getAbsenceRequestById(id: number): Promise<AbsenceRequest | null> {
  const rows = await db
    .select()
    .from(absenceRequestsTable)
    .where(eq(absenceRequestsTable.id, id))
    .limit(1);

  return (rows[0] as unknown as AbsenceRequest) ?? null;
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

/**
 * absenceStore.ts — PostgreSQL-backed store for the absence protocol.
 *
 * Tables used:
 *   absence_requests         — one row per beneficiary unlock request
 *   absence_guardian_decisions — one row per guardian per request (vote token + result)
 * 
 * P1 HARDENING: Added isNull check to recordGuardianDecision to prevent 
 * race-condition overwrites at the database query level.
 */

import crypto from 'crypto';
import { db } from '@workspace/db';
import {
  absenceRequestsTable,
  absenceGuardianDecisionsTable,
} from '@workspace/db';
import { eq, and, or, desc, isNull } from 'drizzle-orm';

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

export async function createOrReuseAbsenceRequest(
  ownerEmail: string,
  beneficiaryEmail: string,
  beneficiaryName: string,
  ownerName: string,
): Promise<AbsenceRequest> {
  const oKey = ownerEmail.toLowerCase();

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

export async function getLatestAbsenceRequest(ownerEmail: string): Promise<AbsenceRequest | null> {
  const rows = await db
    .select()
    .from(absenceRequestsTable)
    .where(eq(absenceRequestsTable.ownerEmail, ownerEmail.toLowerCase()))
    .orderBy(desc(absenceRequestsTable.requestedAt))
    .limit(1);

  return (rows[0] as unknown as AbsenceRequest) ?? null;
}

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

export async function getRequestByAliveToken(token: string): Promise<AbsenceRequest | null> {
  const rows = await db
    .select()
    .from(absenceRequestsTable)
    .where(eq(absenceRequestsTable.ownerAliveToken, token))
    .limit(1);

  return (rows[0] as unknown as AbsenceRequest) ?? null;
}

// ── State transitions ────────────────────────────────────────────────────────

export async function recordOwnerNotification(requestId: number, newCount: number): Promise<void> {
  await db
    .update(absenceRequestsTable)
    .set({ ownerLastNotifiedAt: Date.now(), ownerNotifCount: newCount })
    .where(eq(absenceRequestsTable.id, requestId));
}

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
          eq(absenceRequestsTable.status, 'pending_guardian_vote'),
        ),
      ),
    );
}

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

/** Record a guardian's vote. (P1 HARDENED) */
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
        isNull(absenceGuardianDecisionsTable.decision), // ✅ P1 FIX
      ),
    );
}

export async function getAbsenceRequestById(id: number): Promise<AbsenceRequest | null> {
  const rows = await db
    .select()
    .from(absenceRequestsTable)
    .where(eq(absenceRequestsTable.id, id))
    .limit(1);

  return (rows[0] as unknown as AbsenceRequest) ?? null;
}

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
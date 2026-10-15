/**
 * routes/absence.ts — Absence / death protocol endpoints.
 *
 * Flow:
 *   1. POST /api/absence/initiate              — beneficiary starts the protocol
 *   2. Server scheduler (Vercel Cron via /api/cron/absence-tick): notifies owner every 3h for 48h
 *      - Hybrid delivery: Push first (email→userId→tokens), Email as guaranteed fallback.
 *      - Owner responds via GET /api/absence/owner-alive/:token  → cancelled
 *      - After 16 notifications (48h) with no response → pending_beneficiary_confirmation
 *   3. GET  /api/absence/status/:ownerEmail    — poll current status
 *   4. POST /api/absence/beneficiary-confirm   — beneficiary confirms after 48h wait
 *      → triggers guardian vote emails
 *   5. GET  /api/absence/guardian-vote/:token  — guardian votes approve/reject
 *   6. GET  /api/absence/vote-status/:ownerEmail — poll guardian voting progress
 *   7. POST /api/absence/start-vote            — (re-trigger guardian vote)
 *   8. POST /api/absence/cancel                — owner cancels manually from app
 */

import { Router } from 'express';
import { E_ALREADY_LOCKED, Mutex, tryAcquire } from 'async-mutex';
import {
  createOrReuseAbsenceRequest,
  getLatestAbsenceRequest,
  getActiveRequests,
  getAbsenceRequestById,
  getRequestByAliveToken,
  getDecisionByToken,
  recordGuardianDecision,
  countApprovals,
  cancelAbsenceRequest,
  completeAbsenceRequest,
  startGuardianVote,
  createGuardianDecisionSlots,
  recordOwnerNotification,
  transitionToBeneficiaryConfirmation,
} from '../lib/absenceStore';
import {
  sendOwnerNotification,
  sendOwnerAliveNotification,
  sendBeneficiaryOwnerAbsent,
  sendGuardianVoteRequest,
  sendWithRetry,
} from '../lib/emailService';
import { lookupSealedVault } from '../lib/keyStore';
import { generateOtp } from '../lib/otpStore';
import { logger } from '../lib/logger';
import { db, absenceGuardianDecisionsTable, userPushTokensTable } from '@workspace/db';
import { eq, sql } from 'drizzle-orm';
import { clerkClient } from '@clerk/express';
import { requireAuth, requireOwner, requireVaultParticipant } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { absenceBody, ownerOnlyBody } from '../middleware/schemas';

const router = Router();

const NOTIFY_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours
const MAX_NOTIFICATIONS   = 16;                  // 48h / 3h = 16

/* ─── Identity bridge: email → Clerk userId → push tokens ──────────────────── */
/**
 * The absence protocol is keyed by EMAIL (vault owner/beneficiary), but push
 * tokens are stored under the Clerk USER ID. This resolver bridges the two.
 * Returns null if no Clerk user matches — callers MUST then fall back to email.
 */
async function resolveUserIdByEmail(email: string): Promise<string | null> {
  try {
    if (!email) return null;
    const res = await clerkClient.users.getUserList({ emailAddress: [email], limit: 1 });
    const arr: any[] = Array.isArray(res) ? res : ((res as any)?.data ?? []);
    return arr[0]?.id ?? null;
  } catch (e) {
    logger.warn({ err: e, email }, 'Absence push: email→userId resolution failed');
    return null;
  }
}

/**
 * Attempt a push to every registered device of the user identified by `email`.
 * Returns true only if at least one Expo ticket came back 'ok'. On ANY failure
 * (no user, no tokens, Expo error) it returns false so the caller sends email.
 * This guarantees there is never a silent miss for a security-critical alert.
 */
async function sendPushToUserByEmail(email: string, title: string, body: string): Promise<boolean> {
  try {
    const userId = await resolveUserIdByEmail(email);
    if (!userId) return false;

    const tokensRows = await db
      .select()
      .from(userPushTokensTable)
      .where(eq(userPushTokensTable.userId, userId));

    if (tokensRows.length === 0) return false; // no devices registered yet

    const messages = tokensRows.map((row) => ({
      to: row.token,
      title,
      body,
      sound: null,
      data: { timestamp: Date.now(), app: 'auryx', type: 'absence' },
    }));

    const expoResponse = await fetch('https://api.expo.io/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    if (!expoResponse.ok) {
      logger.warn({ status: expoResponse.status }, 'Expo Push API returned non-2xx');
      return false;
    }

    const result = (await expoResponse.json()) as { data?: { status?: string }[] };
    return Boolean(result.data?.some((t) => t.status === 'ok'));
  } catch (e) {
    logger.error({ err: e }, 'Failed to dispatch absence push (will fall back to email)');
    return false;
  }
}

function getBaseUrl(): string {
  const d = process.env.REPLIT_DOMAINS;
  if (d) return `https://${d.split(',')[0].trim()}`;
  const dev = process.env.REPLIT_DEV_DOMAIN;
  if (dev) return `https://${dev}`;
  return 'https://getauryx.com';
}

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html><html dir="rtl" lang="ar">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  *{box-sizing:border-box}
  body{background:#0A0F1E;color:#E2E8F0;font-family:Arial,Helvetica,sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
  .card{background:rgba(255,255,255,0.05);border:1px solid rgba(212,175,55,0.25);
        border-radius:20px;max-width:480px;width:100%;padding:40px;text-align:center}
  .logo{font-size:28px;font-weight:700;color:#D4AF37;letter-spacing:3px;margin-bottom:8px}
  h2{color:#E2E8F0;margin:16px 0 8px}
  p{color:#94A3B8;line-height:1.7}
  .green{color:#22C55E} .red{color:#EF4444}
</style></head>
<body><div class="card">
<div class="logo">⬡ Auryx</div>
${body}
</div></body></html>`;
}

// ── Shared guardian-vote helper ────────────────────────────────────────────────
/** Create decision slots + send guardian vote emails for an absence request. */
async function triggerGuardianVoteEmails(absReqId: number, ownerEmail: string): Promise<number> {
  const vault = await lookupSealedVault(ownerEmail);
  if (!vault || vault.guardianPackages.length === 0) return 0;

  const guardianEmails = vault.guardianPackages.map((gp) => gp.email).filter(Boolean);
  // Must check BEFORE startGuardianVote to avoid transitioning status with 0 guardians
  if (guardianEmails.length === 0) return 0;

  const absReq = await getAbsenceRequestById(absReqId);
  if (!absReq) return 0;

  await startGuardianVote(absReqId);

  const tokenMap = await createGuardianDecisionSlots(absReqId, guardianEmails);
  const base = getBaseUrl();
  const linkMap = new Map<string, { approveUrl: string; rejectUrl: string }>();
  for (const [email, token] of tokenMap.entries()) {
    linkMap.set(email, {
      approveUrl: `${base}/api/absence/guardian-vote/${token}?vote=approve`,
      rejectUrl:  `${base}/api/absence/guardian-vote/${token}?vote=reject`,
    });
  }

  const ownerName = absReq.ownerName || ownerEmail;
  const benefName = absReq.beneficiaryName || 'المستفيد';

  try {
    await sendGuardianVoteRequest(ownerName, benefName, guardianEmails, linkMap);
  } catch (mailErr) {
    logger.warn({ mailErr }, 'Absence: guardian vote emails failed (non-fatal)');
  }

  return guardianEmails.length;
}

// ── Background scheduler ───────────────────────────────────────────────────────
async function processAbsenceScheduler(): Promise<{ active: number; processed: number }> {
  const start = Date.now();
  logger.info({ startTime: start }, 'Absence scheduler: run started');

  const active = await getActiveRequests();
  let processed = 0;

  for (const absReq of active) {
    if (absReq.status !== 'pending_owner') continue;
    processed += 1;

    const now      = Date.now();
    const lastSent = absReq.ownerLastNotifiedAt ?? 0;

    if (absReq.ownerNotifCount >= MAX_NOTIFICATIONS) {
      // 48h elapsed with no owner response — move to beneficiary confirmation
      try {
        await transitionToBeneficiaryConfirmation(absReq.id);

        // HYBRID: push the beneficiary first, email as guaranteed fallback
        const pushOk = await sendPushToUserByEmail(
          absReq.beneficiaryEmail,
          'تنبيه أمني حرج',
          'مرّت 48 ساعة دون رد من صاحب الخزنة. يرجى الدخول للتطبيق لإكمال الإجراءات.',
        );
        if (!pushOk) {
          await sendBeneficiaryOwnerAbsent(
            absReq.beneficiaryEmail,
            absReq.ownerName || absReq.ownerEmail,
          );
        }

        logger.info(
          { requestId: absReq.id, ownerEmail: absReq.ownerEmail, viaPush: pushOk },
          'Absence scheduler: 48h elapsed, awaiting beneficiary confirmation',
        );
      } catch (err) {
        logger.error({ err, requestId: absReq.id }, 'Absence scheduler: beneficiary-absent alert failed');
      }
      continue;
    }

    if (now - lastSent < NOTIFY_INTERVAL_MS) continue; // not yet time

    // Send next 3-hourly notification to owner — HYBRID (push first, email fallback)
    const nextCount = absReq.ownerNotifCount + 1;
    const aliveUrl  = absReq.ownerAliveToken
      ? `${getBaseUrl()}/api/absence/owner-alive/${absReq.ownerAliveToken}`
      : '';

    try {
      const pushOk = await sendPushToUserByEmail(
        absReq.ownerEmail,
        '🛡️ تأكيد الحضور مطلوب',
        `مرّت ${nextCount * 3} ساعات دون تأكيد حضورك. افتح التطبيق أو اضغط رابط الأمان لتأكيد أنك بخير.`,
      );
      if (!pushOk) {
        await sendOwnerNotification(
          absReq.ownerEmail,
          absReq.ownerName || absReq.ownerEmail,
          absReq.beneficiaryName || 'المستفيد',
          nextCount,
          aliveUrl,
        );
      }
      await recordOwnerNotification(absReq.id, nextCount);
      logger.info(
        { requestId: absReq.id, ownerEmail: absReq.ownerEmail, notifCount: nextCount, viaPush: pushOk },
        'Absence scheduler: owner notification sent',
      );
    } catch (err) {
      logger.error({ err, requestId: absReq.id }, 'Absence scheduler: owner notification failed');
    }
  }

  const end = Date.now();
  const activeCount = active.length;
  logger.info(
    { startTime: start, endTime: end, durationMs: end - start, active: activeCount, processed },
    'Absence scheduler: run completed',
  );

  return { active: activeCount, processed };
}

// The mutex prevents overlapping ticks in one process. tryAcquire is used so a
// second tick skips immediately rather than waiting behind a slow run.
const absenceSchedulerMutex = new Mutex();
const ABSENCE_SCHEDULER_LOCK_ID = 42;

/**
 * Run one scheduler tick with a process-local mutex and a PostgreSQL advisory
 * lock. The advisory lock is acquired and released from the same transaction
 * connection, so separate server instances coordinate through PostgreSQL.
 * Exported so the Vercel-Cron trigger route (/api/cron/absence-tick) can call it.
 */
export async function runAbsenceSchedulerTick(): Promise<{ active: number; processed: number } | undefined> {
  let release: (() => void) | undefined;

  try {
    release = await tryAcquire(absenceSchedulerMutex).acquire();
  } catch (err) {
    if (err === E_ALREADY_LOCKED) {
      logger.info(
        { locked: true },
        'Absence scheduler: skipping tick because previous run is still in progress',
      );
      return undefined;
    }
    throw err;
  }

  try {
    return await db.transaction(async (tx) => {
      const lockResult = await tx.execute(
        sql`SELECT pg_try_advisory_lock(${ABSENCE_SCHEDULER_LOCK_ID}) AS acquired`,
      );
      const acquired = Boolean(lockResult.rows[0]?.acquired);

      if (!acquired) {
        logger.info(
          { lockId: ABSENCE_SCHEDULER_LOCK_ID },
          'Absence scheduler: another instance is running, skipping',
        );
        return undefined;
      }

      try {
        return await processAbsenceScheduler();
      } finally {
        await tx.execute(
          sql`SELECT pg_advisory_unlock(${ABSENCE_SCHEDULER_LOCK_ID})`,
        );
      }
    });
  } catch (err) {
    logger.error({ err }, 'Absence scheduler: uncaught error');
    return undefined;
  } finally {
    release?.();
  }
}

// NOTE: setInterval intentionally REMOVED. It does not survive Vercel serverless.
// The tick is invoked by /api/cron/absence-tick (GitHub Actions schedule every 5 min).

// ── POST /api/absence/initiate ────────────────────────────────────────────────
router.post('/initiate', requireAuth, validateBody(absenceBody), requireVaultParticipant(), async (req, res, next) => {
  try {
    const {
      ownerEmail,
      beneficiaryName = '',
      ownerName = '',
    } = req.body as { ownerEmail: string; beneficiaryName?: string; ownerName?: string };

    if (!ownerEmail) {
      res.status(400).json({ message: 'ownerEmail is required' });
      return;
    }

    const vault = await lookupSealedVault(ownerEmail);
    if (!vault) {
      res.status(404).json({ message: 'No sealed vault found for this owner' });
      return;
    }

    const absReq = await createOrReuseAbsenceRequest(
      ownerEmail,
      vault.beneficiaryEmail,
      beneficiaryName,
      ownerName,
    );

    // Send immediate notification only on first creation (notifCount === 0)
    if (absReq.ownerNotifCount === 0) {
      const aliveUrl = absReq.ownerAliveToken
        ? `${getBaseUrl()}/api/absence/owner-alive/${absReq.ownerAliveToken}`
        : '';
      try {
        const pushOk = await sendPushToUserByEmail(
          ownerEmail,
          '🛡️ تأكيد الحضور مطلوب',
          'تم بدء بروتوكول الطوارئ على خزنتك. افتح التطبيق أو اضغط رابط الأمان لتأكيد أنك بخير.',
        );
        if (!pushOk) {
          await sendOwnerNotification(
            ownerEmail,
            ownerName || ownerEmail,
            beneficiaryName || 'المستفيد',
            1,
            aliveUrl,
          );
        }
        await recordOwnerNotification(absReq.id, 1);
        req.log.info(
          { requestId: absReq.id, ownerEmail, viaPush: pushOk },
          'Absence: immediate owner notification sent',
        );
      } catch (mailErr) {
        req.log.warn({ mailErr }, 'Absence: immediate owner notification failed (non-fatal)');
      }
    }

    res.json({
      success: true,
      requestId: absReq.id,
      status: absReq.status,
      requestedAt: absReq.requestedAt,
      ownerNotifCount: absReq.ownerNotifCount,
    });
  } catch (err) { next(err); }
});

// ── GET /api/absence/status/:ownerEmail ───────────────────────────────────────
router.get('/status/:ownerEmail', requireAuth, requireVaultParticipant(), async (req, res, next) => {
  try {
    const absReq = await getLatestAbsenceRequest(String(req.params.ownerEmail));
    if (!absReq) {
      res.status(404).json({ message: 'No absence request found', status: 'none' });
      return;
    }
    res.json({
      requestId: absReq.id,
      status: absReq.status,
      ownerNotifCount: absReq.ownerNotifCount,
      requestedAt: absReq.requestedAt,
      guardianVoteStartedAt: absReq.guardianVoteStartedAt,
      completedAt: absReq.completedAt,
    });
  } catch (err) { next(err); }
});

// ── GET /api/absence/owner-alive/:token ───────────────────────────────────────
router.get('/owner-alive/:token', async (req, res, next) => {
  try {
    const absReq = await getRequestByAliveToken(req.params.token);
    if (!absReq) {
      res.status(200).send(htmlPage('رابط غير صالح', `
        <h2 class="red">الرابط غير صالح أو منتهي</h2>
        <p>ربما تم إلغاء البروتوكول بالفعل، أو الرابط خاطئ.</p>
      `));
      return;
    }

    // Owner can cancel at any point before guardian voting starts
    const cancellable = absReq.status === 'pending_owner' || absReq.status === 'pending_beneficiary_confirmation';

    if (!cancellable) {
      res.status(200).send(htmlPage('تمت المعالجة', `
        <h2 class="green">✅ تمت المعالجة بالفعل</h2>
        <p>حالة البروتوكول الحالية: <strong>${absReq.status}</strong></p>
      `));
      return;
    }

    await cancelAbsenceRequest(absReq.id);
    req.log.info(
      { requestId: absReq.id, ownerEmail: absReq.ownerEmail },
      'Absence: owner confirmed alive via email link',
    );

    // Notify beneficiary that owner is alive
    try {
      await sendOwnerAliveNotification(
        absReq.beneficiaryEmail,
        absReq.ownerName || absReq.ownerEmail,
      );
    } catch (mailErr) {
      req.log.warn({ mailErr }, 'Absence: owner-alive beneficiary notification failed (non-fatal)');
    }

    res.status(200).send(htmlPage('تأكيد الحضور', `
      <h2 class="green">✅ تم تأكيد حضورك بنجاح</h2>
      <p>تم إلغاء بروتوكول الطوارئ. أنت بأمان.</p>
      <p>تم إخطار المستفيد النهائي بأنك بخير.</p>
      <p>افتح تطبيق <strong>Auryx</strong> لمزيد من التفاصيل.</p>
    `));
  } catch (err) { next(err); }
});

// ── POST /api/absence/beneficiary-confirm ─────────────────────────────────────
/**
 * Called by the beneficiary after receiving the "owner absent 48h" notification.
 * Validates the request is in pending_beneficiary_confirmation status,
 * then triggers guardian vote emails.
 */
router.post('/beneficiary-confirm', requireAuth, validateBody(ownerOnlyBody), requireVaultParticipant(), async (req, res, next) => {
  try {
    const { ownerEmail } = req.body as { ownerEmail: string };
    if (!ownerEmail) {
      res.status(400).json({ message: 'ownerEmail is required' });
      return;
    }

    const absReq = await getLatestAbsenceRequest(ownerEmail);
    if (!absReq) {
      res.status(404).json({ message: 'No absence request found' });
      return;
    }

    if (absReq.status !== 'pending_beneficiary_confirmation') {
      res.status(409).json({
        message: 'Absence request is not in pending_beneficiary_confirmation state',
        status: absReq.status,
      });
      return;
    }

    const guardianCount = await triggerGuardianVoteEmails(absReq.id, ownerEmail);
    if (guardianCount === 0) {
      res.status(404).json({ message: 'No guardians found for this vault' });
      return;
    }

    req.log.info(
      { requestId: absReq.id, ownerEmail, guardianCount },
      'Absence: beneficiary confirmed — guardian vote emails sent',
    );

    res.json({ success: true, guardianCount });
  } catch (err) { next(err); }
});

// ── GET /api/absence/guardian-vote/:token ─────────────────────────────────────
router.get('/guardian-vote/:token', async (req, res, next) => {
  try {
    const voteParam = (req.query.vote as string | undefined)?.toLowerCase();
    if (voteParam !== 'approve' && voteParam !== 'reject') {
      res.status(400).send(htmlPage('رابط خاطئ', `
        <h2 class="red">الرابط يجب أن يحتوي على ?vote=approve أو ?vote=reject</h2>
      `));
      return;
    }

    const slot = await getDecisionByToken(req.params.token);
    if (!slot) {
      res.status(200).send(htmlPage('رابط منتهي', `
        <h2 class="red">الرابط غير صالح أو منتهي</h2>
        <p>يرجى التواصل مع أصحاب الخزنة.</p>
      `));
      return;
    }

    if (slot.decision !== null) {
      res.status(200).send(htmlPage('تم التصويت', `
        <h2 class="green">✅ لقد صوّتت بالفعل</h2>
        <p>تصويتك مُسجَّل. شكراً لك.</p>
      `));
      return;
    }

    const absReq = await getAbsenceRequestById(slot.requestId);
    if (!absReq || absReq.status !== 'pending_guardian_vote') {
      res.status(200).send(htmlPage('تمت المعالجة', `
        <h2 class="green">✅ تمت معالجة بروتوكول الطوارئ بالفعل</h2>
        <p>حالة البروتوكول: <strong>${absReq?.status ?? 'غير معروف'}</strong></p>
      `));
      return;
    }

    await recordGuardianDecision(slot.requestId, slot.guardianEmail, voteParam);
    req.log.info(
      { requestId: slot.requestId, guardianEmail: slot.guardianEmail, vote: voteParam },
      'Absence: guardian vote recorded',
    );

    // Check if approval threshold is reached
    const vault = await lookupSealedVault(absReq.ownerEmail);
    if (vault && voteParam === 'approve') {
      const approvals = await countApprovals(slot.requestId);
      req.log.info(
        { requestId: slot.requestId, approvals, threshold: vault.threshold },
        'Absence: checking guardian threshold',
      );

      if (approvals >= vault.threshold) {
        await completeAbsenceRequest(slot.requestId, 'guardian_approved');

        const otp = await generateOtp(absReq.ownerEmail, absReq.beneficiaryEmail);
        const otpResult = await sendWithRetry('otp-email', absReq.beneficiaryEmail, {
          ownerName: absReq.ownerName || absReq.ownerEmail,
          otp,
        });

        if (otpResult.success) {
          req.log.info(
            { requestId: slot.requestId, beneficiaryEmail: absReq.beneficiaryEmail },
            'Absence: OTP sent to beneficiary — guardian threshold reached',
          );
        } else {
          req.log.error(
            { requestId: slot.requestId, beneficiaryEmail: absReq.beneficiaryEmail, error: otpResult.error },
            'Absence: failed to send OTP to beneficiary after retries',
          );
        }
      }
    }

    const label = voteParam === 'approve' ? 'الموافقة ✅' : 'الرفض ❌';
    res.status(200).send(htmlPage('تم التصويت', `
      <h2 class="green">✅ تم تسجيل تصويتك</h2>
      <p>اخترت: <strong>${label}</strong></p>
      <p>شكراً على مشاركتك في بروتوكول الأمان.</p>
    `));
  } catch (err) { next(err); }
});

// ── POST /api/absence/start-vote ──────────────────────────────────────────────
/**
 * Re-triggers guardian vote emails for an existing absence request.
 * Accepts requests in pending_guardian_vote or pending_beneficiary_confirmation status.
 */
router.post('/start-vote', requireAuth, validateBody(ownerOnlyBody), requireVaultParticipant(), async (req, res, next) => {
  try {
    const { ownerEmail } = req.body as { ownerEmail: string };

    if (!ownerEmail) {
      res.status(400).json({ message: 'ownerEmail is required' });
      return;
    }

    const vault = await lookupSealedVault(ownerEmail);
    if (!vault || vault.guardianPackages.length === 0) {
      res.status(404).json({ message: 'No guardians found for this vault' });
      return;
    }

    // Only allow resending to an already-initiated vote — never bypass the 48h window.
    const absReq = await getLatestAbsenceRequest(ownerEmail);
    const validStatuses = ['pending_guardian_vote', 'pending_beneficiary_confirmation'];
    if (!absReq || !validStatuses.includes(absReq.status)) {
      res.status(404).json({ message: 'No absence request ready for guardian voting (must be in pending_beneficiary_confirmation or pending_guardian_vote)' });
      return;
    }

    const guardianCount = await triggerGuardianVoteEmails(absReq.id, ownerEmail);

    req.log.info(
      { requestId: absReq.id, ownerEmail, guardianCount },
      'Absence: guardian vote emails re-sent via start-vote',
    );

    res.json({ success: true, requestId: absReq.id, guardianCount });
  } catch (err) { next(err); }
});

// ── GET /api/absence/vote-status/:ownerEmail ───────────────────────────────────
router.get('/vote-status/:ownerEmail', requireAuth, requireVaultParticipant(), async (req, res, next) => {
  try {
    const absReq = await getLatestAbsenceRequest(String(req.params.ownerEmail));
    if (!absReq) {
      res.status(404).json({ message: 'No absence request found' });
      return;
    }

    const slots = await db
      .select()
      .from(absenceGuardianDecisionsTable)
      .where(eq(absenceGuardianDecisionsTable.requestId, absReq.id));

    const vault = await lookupSealedVault(String(req.params.ownerEmail));
    const threshold  = vault?.threshold ?? 1;
    const approvals  = slots.filter((s) => s.decision === 'approve').length;
    const rejections = slots.filter((s) => s.decision === 'reject').length;

    res.json({
      requestId: absReq.id,
      status: absReq.status,
      threshold,
      approvals,
      rejections,
      quorumReached: approvals >= threshold,
      beneficiaryEmail: absReq.beneficiaryEmail,
      decisions: slots.map((s) => ({
        guardianEmail: s.guardianEmail,
        decision: s.decision,
        decidedAt: s.decidedAt,
      })),
    });
  } catch (err) { next(err); }
});

// ── POST /api/absence/cancel ──────────────────────────────────────────────────
router.post('/cancel', requireAuth, validateBody(ownerOnlyBody), requireOwner(), async (req, res, next) => {
  try {
    const { ownerEmail } = req.body as { ownerEmail: string };
    if (!ownerEmail) {
      res.status(400).json({ message: 'ownerEmail is required' });
      return;
    }

    const absReq = await getLatestAbsenceRequest(ownerEmail);
    const cancellable = absReq && (absReq.status === 'pending_owner' || absReq.status === 'pending_beneficiary_confirmation');
    if (!cancellable) {
      res.status(404).json({ message: 'No active pending absence request found' });
      return;
    }

    await cancelAbsenceRequest(absReq.id);
    req.log.info({ requestId: absReq.id, ownerEmail }, 'Absence: owner cancelled via app');

    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
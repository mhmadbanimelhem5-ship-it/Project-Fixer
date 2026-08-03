import { Router } from 'express';
import { lt } from 'drizzle-orm';
import { db, inviteTokensTable } from '@workspace/db';
import { logger } from '../lib/logger';
import {
  checkEmailHealth,
  createToken,
  sendGuardianInvite,
  sendGuardianRemoved,
  sendBeneficiaryInvite,
  sendBeneficiaryRemoved,
  sendEmergencyActivation,
  sendVoteRequest,
  sendOwnerNotification,
} from '../lib/emailService';
import { authLimiter } from '../middleware/rateLimit';
import { requireAuth, requireOwner, requireVaultParticipant } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import {
  emailInviteBeneficiaryBody,
  emailInviteGuardianBody,
  emailRemoveBeneficiaryBody,
  emailRemoveGuardianBody,
  emergencyEmailBody,
  ownerNotificationBody,
  voteRequestBody,
} from '../middleware/schemas';

const router = Router();

function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${field} is required`);
  return v.trim();
}

function emailStr(v: unknown, field: string): string {
  const s = str(v, field);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new Error(`${field} must be a valid email`);
  return s;
}

function emailArr(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) throw new Error(`${field} must be an array`);
  return v.map((e, i) => emailStr(e, `${field}[${i}]`));
}

// ── 0. Health check ───────────────────────────────────────────────────────────
// Returns which email provider is active and whether SMTP is reachable.
// Used by the mobile app to diagnose "SMTP not configured" errors.
router.get('/healthz', async (req, res, next) => {
  try {
    const health = await checkEmailHealth();
    res.json(health);
  } catch (err) { next(err); }
});

// ── 1. Invite guardian ────────────────────────────────────────────────────────
router.post('/invite-guardian', requireAuth, authLimiter, validateBody(emailInviteGuardianBody), requireOwner(), async (req, res, next) => {
  try {
    const ownerName    = str(req.body.ownerName, 'ownerName');
    const guardianName = str(req.body.guardianName, 'guardianName');
    const guardianEmail = emailStr(req.body.guardianEmail, 'guardianEmail');

    const token = await createToken('guardian-invite', guardianEmail, ownerName, { guardianName });
    await sendGuardianInvite(ownerName, guardianEmail, token);

    res.json({ success: true, token });
  } catch (err) {
    req.log.error({ err, path: 'invite-guardian' }, 'Email send failed');
    res.status(502).json({ success: false, error: 'email_delivery_failed' });
  }
});

// ── 2. Remove guardian ────────────────────────────────────────────────────────
router.post('/remove-guardian', requireAuth, validateBody(emailRemoveGuardianBody), requireOwner(), async (req, res, next) => {
  try {
    const ownerName    = str(req.body.ownerName, 'ownerName');
    const guardianEmail = emailStr(req.body.guardianEmail, 'guardianEmail');

    await sendGuardianRemoved(ownerName, guardianEmail);
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err, path: 'remove-guardian' }, 'Email send failed');
    res.status(502).json({ success: false, error: 'email_delivery_failed' });
  }
});

// ── 3. Invite beneficiary ─────────────────────────────────────────────────────
router.post('/invite-beneficiary', requireAuth, authLimiter, validateBody(emailInviteBeneficiaryBody), requireOwner(), async (req, res, next) => {
  try {
    const ownerName       = str(req.body.ownerName, 'ownerName');
    const beneficiaryName = str(req.body.beneficiaryName, 'beneficiaryName');
    const beneficiaryEmail = emailStr(req.body.beneficiaryEmail, 'beneficiaryEmail');
    const relationship    = typeof req.body.relationship === 'string' ? req.body.relationship : '';

    const token = await createToken('beneficiary-invite', beneficiaryEmail, ownerName, { beneficiaryName, relationship });
    await sendBeneficiaryInvite(ownerName, beneficiaryEmail, relationship, token);

    res.json({ success: true, token });
  } catch (err) {
    req.log.error({ err, path: 'invite-beneficiary' }, 'Email send failed');
    res.status(502).json({ success: false, error: 'email_delivery_failed' });
  }
});

// ── 4. Remove beneficiary ─────────────────────────────────────────────────────
router.post('/remove-beneficiary', requireAuth, validateBody(emailRemoveBeneficiaryBody), requireOwner(), async (req, res, next) => {
  try {
    const ownerName       = str(req.body.ownerName, 'ownerName');
    const beneficiaryEmail = emailStr(req.body.beneficiaryEmail, 'beneficiaryEmail');

    await sendBeneficiaryRemoved(ownerName, beneficiaryEmail);
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err, path: 'remove-beneficiary' }, 'Email send failed');
    res.status(502).json({ success: false, error: 'email_delivery_failed' });
  }
});

// ── 5. Emergency protocol ─────────────────────────────────────────────────────
// Fire-and-forget: respond immediately so the mobile app doesn't hang while
// emails are dispatched to multiple guardians (SMTP can take several seconds).
router.post('/emergency', requireAuth, validateBody(emergencyEmailBody), requireOwner(), (req, res, next) => {
  try {
    const ownerName          = str(req.body.ownerName, 'ownerName');
    const beneficiaryName    = str(req.body.beneficiaryName, 'beneficiaryName');
    const beneficiaryRelation = typeof req.body.beneficiaryRelation === 'string' ? req.body.beneficiaryRelation : '';
    const guardianEmails     = emailArr(req.body.guardianEmails, 'guardianEmails');

    res.json({ success: true });
    sendEmergencyActivation(ownerName, beneficiaryName, beneficiaryRelation, guardianEmails)
      .catch(err => req.log.error({ err }, 'emergency email background send failed'));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'خطأ غير متوقع';
    res.status(400).json({ success: false, error: message });
  }
});

// ── 6. 48-hour vote request ───────────────────────────────────────────────────
router.post('/vote-request', requireAuth, validateBody(voteRequestBody), requireOwner(), (req, res, next) => {
  try {
    const ownerName      = str(req.body.ownerName, 'ownerName');
    const guardianEmails = emailArr(req.body.guardianEmails, 'guardianEmails');

    res.json({ success: true });
    sendVoteRequest(ownerName, guardianEmails)
      .catch(err => req.log.error({ err }, 'vote-request email background send failed'));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'خطأ غير متوقع';
    res.status(400).json({ success: false, error: message });
  }
});

// ── 7. Notify owner every 3h during 48h wait ─────────────────────────────────
router.post('/notify-owner', requireAuth, validateBody(ownerNotificationBody), requireVaultParticipant(), (req, res, next) => {
  try {
    const ownerEmail      = emailStr(req.body.ownerEmail, 'ownerEmail');
    const ownerName       = str(req.body.ownerName, 'ownerName');
    const beneficiaryName = str(req.body.beneficiaryName, 'beneficiaryName');
    const notifCount      = typeof req.body.notifCount === 'number' ? req.body.notifCount : 1;

    res.json({ success: true });
    sendOwnerNotification(ownerEmail, ownerName, beneficiaryName, notifCount)
      .catch(err => req.log.error({ err }, 'notify-owner email background send failed'));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'خطأ غير متوقع';
    res.status(400).json({ success: false, error: message });
  }
});

// ── Background cleanup: remove expired invite tokens ───────────────────────────
async function cleanupExpiredInviteTokens(): Promise<void> {
  const now = Date.now();
  const result = await db
    .delete(inviteTokensTable)
    .where(lt(inviteTokensTable.expiresAt, now))
    .returning({ token: inviteTokensTable.token });
  logger.info({ deleted: result.length }, 'Expired invite tokens cleaned up');
}

setInterval(() => {
  cleanupExpiredInviteTokens().catch(err =>
    logger.error({ err }, 'Invite token cleanup failed'),
  );
}, 24 * 60 * 60 * 1000);

logger.info('Invite token cleanup scheduler started (interval: 24 hours)');

// Run once at startup to clean leftovers from previous deployments.
cleanupExpiredInviteTokens().catch(err =>
  logger.error({ err }, 'Initial invite token cleanup failed'),
);

export default router;

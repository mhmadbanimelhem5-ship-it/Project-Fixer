import { Router, Request, Response } from 'express';
import { lt } from 'drizzle-orm';
import { db, inviteTokensTable } from '@workspace/db';
import { logger } from '../lib/logger';
import { lookupSealedVault } from '../lib/keyStore';
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

function safeErrorDetails(error: unknown): { errorName?: string; errorCode?: string } {
  const value = error as { name?: unknown; code?: unknown };
  return {
    errorName: typeof value.name === 'string' ? value.name : undefined,
    errorCode: typeof value.code === 'string' ? value.code : undefined,
  };
}

// ── 0. Health check ───────────────────────────────────────────────────────────
router.get('/healthz', async (_req: Request, res: Response): Promise<void> => {
  try {
    const health = await checkEmailHealth();
    res.json(health);
  } catch (err) {
    logger.error({ err }, 'Health check failed');
    res.status(500).json({ error: 'Health check failed' });
  }
});

// ── 1. Invite guardian (C5 & P4 HARDENED) ─────────────────────────────────────
router.post('/invite-guardian', 
  requireAuth, 
  authLimiter, 
  validateBody(emailInviteGuardianBody), 
  requireOwner('ownerEmail'), 
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = (req as any).authUser;
      const ownerEmail = authUser?.email;

      const vault = await lookupSealedVault(ownerEmail);
      if (!vault) {
        logger.warn({ userId: authUser?.id, ownerEmail }, 'C5 Blocked: Invite attempted for non-existent vault');
        res.status(404).json({ success: false, error: 'No sealed vault found for this owner' });
        return;
      }

      const ownerName = str(req.body.ownerName, 'ownerName');
      const guardianName = str(req.body.guardianName, 'guardianName');
      const guardianEmail = emailStr(req.body.guardianEmail, 'guardianEmail');

      // يتم إنشاء التوكن وإرساله بالإيميل فقط
      const token = await createToken('guardian-invite', guardianEmail, ownerName, { guardianName });
      await sendGuardianInvite(ownerName, guardianEmail, token);

      // ✅ P4 FIX: إزالة التوكن من الاستجابة لمنع تسريبه
      res.json({ success: true });
    } catch (error) {
      logger.error({ path: 'invite-guardian', stage: 'execution', ...safeErrorDetails(error) }, 'Invite guardian failed');
      const message = error instanceof Error ? error.message : 'Unexpected error';
      res.status(500).json({ success: false, error: message });
    }
  }
);

// ── 2. Remove guardian ────────────────────────────────────────────────────────
router.post('/remove-guardian', 
  requireAuth, 
  validateBody(emailRemoveGuardianBody), 
  requireOwner('ownerEmail'), 
  async (req: Request, res: Response): Promise<void> => {
    try {
      const ownerName = str(req.body.ownerName, 'ownerName');
      const guardianEmail = emailStr(req.body.guardianEmail, 'guardianEmail');

      await sendGuardianRemoved(ownerName, guardianEmail);
      res.json({ success: true });
    } catch (err) {
      logger.error({ err, path: 'remove-guardian' }, 'Email send failed');
      res.status(502).json({ success: false, error: 'email_delivery_failed' });
    }
  }
);

// ── 3. Invite beneficiary (C5 & P4 HARDENED) ──────────────────────────────────
router.post('/invite-beneficiary', 
  requireAuth, 
  authLimiter, 
  validateBody(emailInviteBeneficiaryBody), 
  requireOwner('ownerEmail'), 
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = (req as any).authUser;
      const ownerEmail = authUser?.email;

      const vault = await lookupSealedVault(ownerEmail);
      if (!vault) {
        logger.warn({ userId: authUser?.id, ownerEmail }, 'C5 Blocked: Invite attempted for non-existent vault');
        res.status(404).json({ success: false, error: 'No sealed vault found for this owner' });
        return;
      }

      const ownerName = str(req.body.ownerName, 'ownerName');
      const beneficiaryName = str(req.body.beneficiaryName, 'beneficiaryName');
      const beneficiaryEmail = emailStr(req.body.beneficiaryEmail, 'beneficiaryEmail');
      const relationship = typeof req.body.relationship === 'string' ? req.body.relationship : '';

      // يتم إنشاء التوكن وإرساله بالإيميل فقط
      const token = await createToken('beneficiary-invite', beneficiaryEmail, ownerName, { beneficiaryName, relationship });
      await sendBeneficiaryInvite(ownerName, beneficiaryEmail, relationship, token);

      // ✅ P4 FIX: إزالة التوكن من الاستجابة لمنع تسريبه
      res.json({ success: true });
    } catch (error) {
      logger.error({ path: 'invite-beneficiary', stage: 'execution', ...safeErrorDetails(error) }, 'Invite beneficiary failed');
      const message = error instanceof Error ? error.message : 'Unexpected error';
      res.status(500).json({ success: false, error: message });
    }
  }
);

// ── 4. Remove beneficiary ─────────────────────────────────────────────────────
router.post('/remove-beneficiary', 
  requireAuth, 
  validateBody(emailRemoveBeneficiaryBody), 
  requireOwner('ownerEmail'), 
  async (req: Request, res: Response): Promise<void> => {
    try {
      const ownerName = str(req.body.ownerName, 'ownerName');
      const beneficiaryEmail = emailStr(req.body.beneficiaryEmail, 'beneficiaryEmail');

      await sendBeneficiaryRemoved(ownerName, beneficiaryEmail);
      res.json({ success: true });
    } catch (err) {
      logger.error({ err, path: 'remove-beneficiary' }, 'Email send failed');
      res.status(502).json({ success: false, error: 'email_delivery_failed' });
    }
  }
);

// ── 5. Emergency protocol (C5 HARDENED) ───────────────────────────────────────
router.post('/emergency', 
  requireAuth, 
  validateBody(emergencyEmailBody), 
  requireOwner('ownerEmail'), 
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = (req as any).authUser;
      const ownerEmail = authUser?.email;

      const vault = await lookupSealedVault(ownerEmail);
      if (!vault) {
        logger.warn({ userId: authUser?.id, ownerEmail }, 'C5 Blocked: Emergency triggered for non-existent vault');
        res.status(404).json({ success: false, error: 'No sealed vault found for this owner' });
        return;
      }

      const ownerName = str(req.body.ownerName, 'ownerName');
      const beneficiaryName = str(req.body.beneficiaryName, 'beneficiaryName');
      const beneficiaryRelation = typeof req.body.beneficiaryRelation === 'string' ? req.body.beneficiaryRelation : '';
      const guardianEmails = emailArr(req.body.guardianEmails, 'guardianEmails');

      res.json({ success: true });

      sendEmergencyActivation(ownerName, beneficiaryName, beneficiaryRelation, guardianEmails)
        .catch(err => logger.error({ err }, 'emergency email background send failed'));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error';
      res.status(400).json({ success: false, error: message });
    }
  }
);

// ── 6. 48-hour vote request (C5 HARDENED) ─────────────────────────────────────
router.post('/vote-request', 
  requireAuth, 
  validateBody(voteRequestBody), 
  requireOwner('ownerEmail'), 
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = (req as any).authUser;
      const ownerEmail = authUser?.email;

      const vault = await lookupSealedVault(ownerEmail);
      if (!vault) {
        logger.warn({ userId: authUser?.id, ownerEmail }, 'C5 Blocked: Vote request for non-existent vault');
        res.status(404).json({ success: false, error: 'No sealed vault found for this owner' });
        return;
      }

      const ownerName = str(req.body.ownerName, 'ownerName');
      const guardianEmails = emailArr(req.body.guardianEmails, 'guardianEmails');

      res.json({ success: true });

      sendVoteRequest(ownerName, guardianEmails)
        .catch(err => logger.error({ err }, 'vote-request email background send failed'));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error';
      res.status(400).json({ success: false, error: message });
    }
  }
);

// ── 7. Notify owner every 3h during 48h wait ─────────────────────────────────
router.post('/notify-owner', 
  requireAuth, 
  validateBody(ownerNotificationBody), 
  requireVaultParticipant('ownerEmail'), 
  async (req: Request, res: Response): Promise<void> => {
    try {
      const ownerEmail = emailStr(req.body.ownerEmail, 'ownerEmail');
      const ownerName = str(req.body.ownerName, 'ownerName');
      const beneficiaryName = str(req.body.beneficiaryName, 'beneficiaryName');
      const notifCount = typeof req.body.notifCount === 'number' ? req.body.notifCount : 1;

      res.json({ success: true });

      sendOwnerNotification(ownerEmail, ownerName, beneficiaryName, notifCount)
        .catch(err => logger.error({ err }, 'notify-owner email background send failed'));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error';
      res.status(400).json({ success: false, error: message });
    }
  }
);

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

cleanupExpiredInviteTokens().catch(err =>
  logger.error({ err }, 'Initial invite token cleanup failed'),
);

export default router;
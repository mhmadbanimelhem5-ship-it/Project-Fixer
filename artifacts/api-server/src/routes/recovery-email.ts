/**
 * routes/recovery-email.ts — Endpoints for managing PIN recovery via a dedicated email.
 *
 * Flow:
 * 1. POST /set          -> Saves the email (unverified), generates OTP, and sends it.
 * 2. POST /verify       -> Verifies the OTP. If correct, marks email as verified and issues a short-lived recoveryToken.
 * 3. POST /complete     -> Consumes the recoveryToken (one-time use) to confirm the PIN was reset locally.
 */

import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { 
  recoveryEmailBody, 
  recoveryOtpVerifyBody, 
  recoveryCompleteBody 
} from '../middleware/schemas';
import { 
  upsertRecoveryEmail, 
  markRecoveryEmailVerified, 
  getRecoveryEmailRecord 
} from '../lib/recoveryEmailStore';
import { generateOtp, verifyOtp } from '../lib/otpStore';
import { sendWithRetry } from '../lib/emailService';
import { logger } from '../lib/logger';

const router = Router();

// In-memory store for short-lived recovery tokens (15-minute expiry)
// This prevents unauthorized PIN resets even if the OTP was somehow intercepted.
const recoveryTokens = new Map<string, { userId: string; expiresAt: number }>();

// Cleanup expired tokens every minute
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of recoveryTokens.entries()) {
    if (now > data.expiresAt) recoveryTokens.delete(token);
  }
}, 60_000);

// ── 1. Set / Update Recovery Email & Send OTP ───────────────────────────────
router.post('/set', requireAuth, validateBody(recoveryEmailBody), async (req, res) => {
  logger.info({ userId: req.authUser?.id, email: req.body.email }, '[DIAGNOSTIC] POST /recovery-email/set received');
  try {
    const { email } = req.body;
    const userId = req.authUser!.id;
    const mainEmail = req.authUser!.email;

    if (email.toLowerCase() === mainEmail.toLowerCase()) {
      logger.warn({ userId, email, mainEmail }, '[DIAGNOSTIC] Recovery email matches main email - rejected');
      return res.status(400).json({ error: 'Recovery email must be different from your main account email' });
    }

    logger.debug({ userId }, '[DIAGNOSTIC] Attempting upsertRecoveryEmail...');
    const result = await upsertRecoveryEmail(userId, email);
    if (!result.success) {
      logger.error({ userId, error: result.error }, '[DIAGNOSTIC] Failed to upsert recovery email');
      return res.status(500).json({ error: 'Failed to save recovery email' });
    }

    logger.debug({ userId, email }, '[DIAGNOSTIC] Generating OTP...');
    const otp = await generateOtp(mainEmail, 'recovery-verify');

    logger.debug({ userId, email }, '[DIAGNOSTIC] Sending OTP via emailService...');
    await sendWithRetry('recovery-otp', email, { otp });

    logger.info({ userId, email }, '[DIAGNOSTIC] Recovery email set and OTP sent successfully');
    res.json({ success: true, message: 'OTP sent to verify email' });
  } catch (err) {
    logger.error({ 
      err, 
      stack: err instanceof Error ? err.stack : undefined 
    }, '[DIAGNOSTIC] Unhandled error in /recovery-email/set');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 2. Verify OTP and Issue Recovery Token ──────────────────────────────────
router.post('/verify', requireAuth, validateBody(recoveryOtpVerifyBody), async (req, res) => {
  logger.info({ userId: req.authUser?.id, email: req.body.email }, '[DIAGNOSTIC] POST /recovery-email/verify received');
  try {
    const { email, otp } = req.body;
    const userId = req.authUser!.id;
    const mainEmail = req.authUser!.email;

    logger.debug({ userId, email }, '[DIAGNOSTIC] Checking recovery email match...');
    const isMatch = await verifyRecoveryEmailMatch(userId, email);
    if (!isMatch) {
      logger.warn({ userId, email }, '[DIAGNOSTIC] Recovery email mismatch');
      return res.status(400).json({ error: 'Invalid recovery email' });
    }

    logger.debug({ userId }, '[DIAGNOSTIC] Verifying OTP...');
    const otpResult = await verifyOtp(mainEmail, 'recovery-verify', otp);
    if (!otpResult.ok) {
      logger.warn({ userId, reason: otpResult.reason }, '[DIAGNOSTIC] OTP verification failed');
      return res.status(400).json({ error: otpResult.reason === 'max_attempts' ? 'Max attempts exceeded' : 'Invalid or expired OTP' });
    }

    logger.debug({ userId }, '[DIAGNOSTIC] Marking recovery email as verified...');
    await markRecoveryEmailVerified(userId);

    const recoveryToken = crypto.randomBytes(32).toString('hex');
    recoveryTokens.set(recoveryToken, { 
      userId, 
      expiresAt: Date.now() + 15 * 60 * 1000 // 15 minutes
    });

    logger.info({ userId }, '[DIAGNOSTIC] Recovery email verified, token issued successfully');
    res.json({ success: true, recoveryToken });
  } catch (err) {
    logger.error({ 
      err, 
      stack: err instanceof Error ? err.stack : undefined 
    }, '[DIAGNOSTIC] Unhandled error in /recovery-email/verify');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 3. Complete PIN Reset (Consume Token) ───────────────────────────────────
router.post('/complete', requireAuth, validateBody(recoveryCompleteBody), async (req, res) => {
  logger.info({ userId: req.authUser?.id }, '[DIAGNOSTIC] POST /recovery-email/complete received');
  try {
    const { recoveryToken } = req.body;
    const userId = req.authUser!.id;

    const tokenData = recoveryTokens.get(recoveryToken);

    if (!tokenData || tokenData.userId !== userId || Date.now() > tokenData.expiresAt) {
      logger.warn({ userId, tokenExists: !!tokenData }, '[DIAGNOSTIC] Invalid or expired recovery token');
      return res.status(403).json({ error: 'Invalid or expired recovery token' });
    }

    recoveryTokens.delete(recoveryToken);

    const record = await getRecoveryEmailRecord(userId);
    logger.info({ userId, recordId: record?.id }, '[DIAGNOSTIC] Recovery PIN reset completed successfully');

    res.json({ success: true });
  } catch (err) {
    logger.error({ 
      err, 
      stack: err instanceof Error ? err.stack : undefined 
    }, '[DIAGNOSTIC] Unhandled error in /recovery-email/complete');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
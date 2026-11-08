/**
 * routes/recovery-email.ts — Endpoints for managing PIN recovery via a dedicated email.
 * 
 * C1 HARDENING: PIN reset is now strictly restricted to the pre-configured, 
 * verified recovery email. Arbitrary emails are rejected if a verified one exists.
 */

import { Router, Request, Response, NextFunction } from 'express';
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
  getRecoveryEmailRecord,
  verifyRecoveryEmailMatch
} from '../lib/recoveryEmailStore';
import { generateOtp, verifyOtp, OTP_PURPOSES } from '../lib/otpStore';
import { sendWithRetry } from '../lib/emailService';
import { logger } from '../lib/logger';

const router = Router();

// In-memory store for short-lived recovery tokens (15-minute expiry)
const recoveryTokens = new Map<string, { userId: string; expiresAt: number }>();

// Cleanup expired tokens every minute
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of recoveryTokens.entries()) {
    if (now > data.expiresAt) recoveryTokens.delete(token);
  }
}, 60_000);

// ── 1. Set / Trigger Recovery Email & Send OTP ───────────────────────────────
router.post('/set', requireAuth, validateBody(recoveryEmailBody), async (req: Request, res: Response) => {
  const userId = (req as any).authUser?.id;
  const mainEmail = (req as any).authUser?.email || '';
  const requestedEmail = req.body.email || '';

  logger.info({ userId, email: requestedEmail }, '[DIAGNOSTIC] POST /recovery-email/set received');

  try {
    const normalizedMainEmail = mainEmail.toLowerCase();
    const normalizedRequestedEmail = requestedEmail.toLowerCase();

    // 1️⃣ Check if there's a pre-configured verified recovery email
    const existingRecord = await getRecoveryEmailRecord(userId);

    if (existingRecord && existingRecord.verified) {
      // 🔒 C1 FIX: Reject if email doesn't match the configured one
      const isMatch = await verifyRecoveryEmailMatch(userId, normalizedRequestedEmail);
      if (!isMatch) {
        logger.warn({ userId, requested: normalizedRequestedEmail }, '[DIAGNOSTIC] Attempted reset with non-configured email - REJECTED (C1 Protected)');
        return res.status(403).json({
          error: 'PIN reset is strictly restricted to the pre-configured recovery email.'
        });
      }
      // If matches, allow sending OTP to the configured email
    } else {
      // First-time setup
      logger.debug({ userId }, '[DIAGNOSTIC] Initial setup: Attempting upsertRecoveryEmail...');
      const result = await upsertRecoveryEmail(userId, normalizedRequestedEmail);
      if (!result.success) {
        logger.error({ userId, error: result.error }, '[DIAGNOSTIC] Failed to upsert recovery email');
        return res.status(500).json({ error: 'Failed to save recovery email' });
      }
    }

    // 2️⃣ Check if email matches main account email
    const isMainEmail = normalizedRequestedEmail === normalizedMainEmail;

    // 3️ Generate and send OTP
    logger.debug({ userId, email: normalizedRequestedEmail }, '[DIAGNOSTIC] Generating and sending OTP...');
    const otp = await generateOtp(normalizedMainEmail, 'recovery-verify', OTP_PURPOSES.recoveryVerify);
    await sendWithRetry('recovery-otp', normalizedRequestedEmail, { otp });

    logger.info({ userId, email: normalizedRequestedEmail, isMainEmail }, '[DIAGNOSTIC] Recovery OTP sent successfully');

    return res.json({
      success: true,
      message: 'OTP sent to verify email',
      isMainEmail: isMainEmail
    });
  } catch (err) {
    logger.error({ 
      err, 
      stack: err instanceof Error ? err.stack : undefined 
    }, '[DIAGNOSTIC] Unhandled error in /recovery-email/set');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 2. Verify OTP and Issue Recovery Token ──────────────────────────────────
router.post('/verify', requireAuth, validateBody(recoveryOtpVerifyBody), async (req: Request, res: Response) => {
  const userId = (req as any).authUser?.id;
  const mainEmail = (req as any).authUser?.email || '';
  const requestedEmail = req.body.email || '';
  const otp = req.body.otp || '';

  logger.info({ userId, email: requestedEmail }, '[DIAGNOSTIC] POST /recovery-email/verify received');

  try {
    const normalizedEmail = requestedEmail.toLowerCase();
    const normalizedMainEmail = mainEmail.toLowerCase();

    logger.debug({ userId, email: normalizedEmail }, '[DIAGNOSTIC] Checking recovery email match...');
    const isMatch = await verifyRecoveryEmailMatch(userId, normalizedEmail);
    if (!isMatch) {
      logger.warn({ userId, email: normalizedEmail }, '[DIAGNOSTIC] Recovery email mismatch');
      return res.status(400).json({ error: 'Invalid recovery email' });
    }

    logger.debug({ userId }, '[DIAGNOSTIC] Verifying OTP...');
    const otpResult = await verifyOtp(normalizedMainEmail, 'recovery-verify', otp, OTP_PURPOSES.recoveryVerify);
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
    return res.json({ success: true, recoveryToken });
  } catch (err) {
    logger.error({ 
      err, 
      stack: err instanceof Error ? err.stack : undefined 
    }, '[DIAGNOSTIC] Unhandled error in /recovery-email/verify');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 3. Complete PIN Reset (Consume Token) ───────────────────────────────────
router.post('/complete', requireAuth, validateBody(recoveryCompleteBody), async (req: Request, res: Response) => {
  const userId = (req as any).authUser?.id;
  const recoveryToken = req.body.recoveryToken || '';

  logger.info({ userId }, '[DIAGNOSTIC] POST /recovery-email/complete received');

  try {
    const tokenData = recoveryTokens.get(recoveryToken);

    if (!tokenData || tokenData.userId !== userId || Date.now() > tokenData.expiresAt) {
      logger.warn({ userId, tokenExists: !!tokenData }, '[DIAGNOSTIC] Invalid or expired recovery token');
      return res.status(403).json({ error: 'Invalid or expired recovery token' });
    }

    recoveryTokens.delete(recoveryToken);

    const record = await getRecoveryEmailRecord(userId);
    logger.info({ userId, recordId: record?.id }, '[DIAGNOSTIC] Recovery PIN reset completed successfully');

    return res.json({ success: true });
  } catch (err) {
    logger.error({ 
      err, 
      stack: err instanceof Error ? err.stack : undefined 
    }, '[DIAGNOSTIC] Unhandled error in /recovery-email/complete');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
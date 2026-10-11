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
  try {
    const { email } = req.body;
    const userId = req.authUser!.id;
    const mainEmail = req.authUser!.email;

    // Prevent using the main Clerk email as recovery email (optional but recommended for security)
    if (email.toLowerCase() === mainEmail.toLowerCase()) {
      return res.status(400).json({ error: 'Recovery email must be different from your main account email' });
    }

    const result = await upsertRecoveryEmail(userId, email);
    if (!result.success) {
      logger.error({ userId, error: result.error }, 'Failed to upsert recovery email');
      return res.status(500).json({ error: 'Failed to save recovery email' });
    }

    // Generate a 6-digit OTP specifically for recovery verification
    // We use mainEmail as owner, and 'recovery-verify' as the beneficiary marker
    const otp = await generateOtp(mainEmail, 'recovery-verify');

    // Send the OTP via the robust retry mechanism
    await sendWithRetry('recovery-otp', email, { otp });

    logger.info({ userId, email }, 'Recovery email set and OTP sent');
    res.json({ success: true, message: 'OTP sent to verify email' });
  } catch (err) {
    logger.error({ err }, 'Error in /recovery-email/set');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 2. Verify OTP and Issue Recovery Token ──────────────────────────────────
router.post('/verify', requireAuth, validateBody(recoveryOtpVerifyBody), async (req, res) => {
  try {
    const { email, otp } = req.body;
    const userId = req.authUser!.id;
    const mainEmail = req.authUser!.email;

    // 1. Check if this email matches the stored hash for this user
    const isMatch = await verifyRecoveryEmailMatch(userId, email);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid recovery email' });
    }

    // 2. Verify the OTP
    const otpResult = await verifyOtp(mainEmail, 'recovery-verify', otp);
    if (!otpResult.ok) {
      return res.status(400).json({ error: otpResult.reason === 'max_attempts' ? 'Max attempts exceeded' : 'Invalid or expired OTP' });
    }

    // 3. Mark the recovery email as verified in the database
    await markRecoveryEmailVerified(userId);

    // 4. Generate a short-lived, one-time recovery token for the frontend
    const recoveryToken = crypto.randomBytes(32).toString('hex');
    recoveryTokens.set(recoveryToken, { 
      userId, 
      expiresAt: Date.now() + 15 * 60 * 1000 // 15 minutes
    });

    logger.info({ userId }, 'Recovery email verified, token issued');
    res.json({ success: true, recoveryToken });
  } catch (err) {
    logger.error({ err }, 'Error in /recovery-email/verify');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 3. Complete PIN Reset (Consume Token) ───────────────────────────────────
router.post('/complete', requireAuth, validateBody(recoveryCompleteBody), async (req, res) => {
  try {
    const { recoveryToken } = req.body;
    const userId = req.authUser!.id;

    const tokenData = recoveryTokens.get(recoveryToken);

    // Validate token: exists, belongs to this user, and not expired
    if (!tokenData || tokenData.userId !== userId || Date.now() > tokenData.expiresAt) {
      return res.status(403).json({ error: 'Invalid or expired recovery token' });
    }

    // Invalidate the token immediately (one-time use)
    recoveryTokens.delete(recoveryToken);

    // Optional: Fetch record for logging purposes
    const record = await getRecoveryEmailRecord(userId);
    logger.info({ userId, recordId: record?.id }, 'Recovery PIN reset completed successfully');

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Error in /recovery-email/complete');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
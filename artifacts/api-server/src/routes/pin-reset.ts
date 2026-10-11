/**
 * routes/pin-reset.ts — PIN reset via guardian quorum endpoints.
 *
 * Flow:
 *   1. POST /api/pin-reset/request           — owner requests reset, server emails guardians
 *   2. GET  /api/pin-reset/status/:ownerEmail — poll voting progress
 *   3. GET  /api/pin-reset/guardian-vote/:token — guardian clicks approve/reject link
 *   4. POST /api/pin-reset/verify-otp        — owner enters OTP, server returns one-time resetToken
 *   5. POST /api/pin-reset/complete          — frontend confirms local PIN change, server invalidates request
 */

import { Router } from 'express';
import crypto from 'crypto';
import {
  createOrReusePinResetRequest,
  getLatestPinResetRequest,
  startGuardianVote,
  createGuardianDecisionSlots,
  getDecisionByToken,
  recordGuardianDecision,
  countApprovals,
  completePinResetRequest,
  getGuardianDecisions,
  getPinResetRequestById,
} from '../lib/pinResetStore';
import { lookupSealedVault } from '../lib/keyStore';
import { generateOtp, verifyOtp } from '../lib/otpStore';
import { sendGuardianVoteRequest, sendWithRetry } from '../lib/emailService';
import { logger } from '../lib/logger';
import { requireAuth, requireVaultParticipant } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { ownerOnlyBody } from '../middleware/schemas';

const router = Router();

// In-memory store for short-lived reset tokens (5-minute expiry)
// Avoids DB schema changes while maintaining security.
const resetTokens = new Map<string, { ownerEmail: string; expiresAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of resetTokens.entries()) {
    if (now > data.expiresAt) resetTokens.delete(token);
  }
}, 60_000); // Clean up every minute

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

// ── POST /api/pin-reset/request ──────────────────────────────────────────────
router.post('/request', requireAuth, validateBody(ownerOnlyBody), requireVaultParticipant(), async (req, res, next) => {
  try {
    const { ownerEmail, ownerName } = req.body as { ownerEmail: string; ownerName: string };
    if (!ownerEmail) {
      res.status(400).json({ message: 'ownerEmail is required' });
      return;
    }

    const vault = await lookupSealedVault(ownerEmail);
    if (!vault || vault.guardianPackages.length === 0) {
      res.status(404).json({ message: 'No guardians found for this vault' });
      return;
    }

    const guardianEmails = vault.guardianPackages.map((gp) => gp.email).filter(Boolean);

    // Create or reuse the request
    const pinReq = await createOrReusePinResetRequest(ownerEmail, ownerName);

    // If it's a new request (just created), start voting and send emails
    if (pinReq.guardianVoteStartedAt === null) {
      await startGuardianVote(pinReq.id);
      const tokenMap = await createGuardianDecisionSlots(pinReq.id, guardianEmails);
      const base = getBaseUrl();
      const linkMap = new Map<string, { approveUrl: string; rejectUrl: string }>();

      for (const [email, token] of tokenMap.entries()) {
        linkMap.set(email, {
          approveUrl: `${base}/api/pin-reset/guardian-vote/${token}?vote=approve`,
          rejectUrl:  `${base}/api/pin-reset/guardian-vote/${token}?vote=reject`,
        });
      }

      try {
        await sendGuardianVoteRequest(ownerName, 'صاحب الخزنة', guardianEmails, linkMap);
        logger.info({ requestId: pinReq.id, ownerEmail }, 'PIN-Reset: guardian vote emails sent');
      } catch (mailErr) {
        logger.warn({ mailErr, requestId: pinReq.id }, 'PIN-Reset: guardian vote emails failed (non-fatal)');
      }
    }

    res.json({
      success: true,
      requestId: pinReq.id,
      guardianCount: guardianEmails.length,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/pin-reset/status/:ownerEmail ────────────────────────────────────
router.get('/status/:ownerEmail', requireAuth, requireVaultParticipant(), async (req, res, next) => {
  try {
    const pinReq = await getLatestPinResetRequest(String(req.params.ownerEmail));
    if (!pinReq) {
      res.status(404).json({ message: 'No PIN-reset request found', status: 'none' });
      return;
    }

    // Check expiry
    if (Date.now() > pinReq.expiresAt && pinReq.status === 'pending_guardian_vote') {
      await completePinResetRequest(pinReq.id, 'expired');
      res.json({
        requestId: pinReq.id,
        status: 'expired',
        threshold: 0,
        approvals: 0,
        rejections: 0,
        quorumReached: false,
        otpSent: false,
        expiresAt: pinReq.expiresAt,
        decisions: [],
      });
      return;
    }

    const decisions = await getGuardianDecisions(pinReq.id);
    const approvals = decisions.filter((d) => d.decision === 'approve').length;
    const rejections = decisions.filter((d) => d.decision === 'reject').length;

    // Fetch threshold from vault
    const vault = await lookupSealedVault(String(req.params.ownerEmail));
    const threshold = vault?.threshold ?? 1;
    const quorumReached = approvals >= threshold;

    res.json({
      requestId: pinReq.id,
      status: pinReq.status,
      threshold,
      approvals,
      rejections,
      quorumReached,
      otpSent: pinReq.status === 'approved', // simplified flag
      expiresAt: pinReq.expiresAt,
      decisions,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/pin-reset/guardian-vote/:token ──────────────────────────────────
router.get('/guardian-vote/:token', async (req, res, next) => {
  try {
    const voteParam = (req.query.vote as string | undefined)?.toLowerCase();
    if (voteParam !== 'approve' && voteParam !== 'reject') {
      res.status(400).send(htmlPage('رابط خاطئ', `<h2 class="red">الرابط يجب أن يحتوي على ?vote=approve أو ?vote=reject</h2>`));
      return;
    }

    const slot = await getDecisionByToken(req.params.token);
    if (!slot) {
      res.status(200).send(htmlPage('رابط منتهي', `<h2 class="red">الرابط غير صالح أو منتهي</h2><p>يرجى التواصل مع صاحب الخزنة.</p>`));
      return;
    }

    if (slot.decision !== null) {
      res.status(200).send(htmlPage('تم التصويت', `<h2 class="green">✅ لقد صوّتت بالفعل</h2><p>تصويتك مُسجَّل. شكراً لك.</p>`));
      return;
    }

    const pinReq = await getPinResetRequestById(slot.requestId);
    if (!pinReq || pinReq.status !== 'pending_guardian_vote') {
      res.status(200).send(htmlPage('تمت المعالجة', `<h2 class="green">✅ تمت معالجة هذا الطلب بالفعل</h2><p>الحالة الحالية: <strong>${pinReq?.status ?? 'غير معروف'}</strong></p>`));
      return;
    }

    await recordGuardianDecision(slot.requestId, slot.guardianEmail, voteParam);
    logger.info({ requestId: slot.requestId, guardianEmail: slot.guardianEmail, vote: voteParam }, 'PIN-Reset: guardian vote recorded');

    // Check quorum
    if (voteParam === 'approve') {
      const approvals = await countApprovals(slot.requestId);
      const threshold = pinReq ? (await lookupSealedVault(pinReq.ownerEmail))?.threshold ?? 1 : 1;

      if (approvals >= threshold) {
        await completePinResetRequest(slot.requestId, 'approved');

        // Generate OTP specifically for PIN reset (using 'pin-reset-owner' as beneficiary marker)
        const otp = await generateOtp(pinReq.ownerEmail, 'pin-reset-owner');

        // Send the OTP email to the owner using the robust retry mechanism
        await sendWithRetry('otp-email', pinReq.ownerEmail, { ownerName: pinReq.ownerName, otp });

        logger.info({ requestId: slot.requestId, ownerEmail: pinReq.ownerEmail }, 'PIN-Reset: quorum reached, OTP generated and emailed successfully');
      }
    }

    const label = voteParam === 'approve' ? 'الموافقة ✅' : 'الرفض ❌';
    res.status(200).send(htmlPage('تم التصويت', `<h2 class="green">✅ تم تسجيل تصويتك</h2><p>اخترت: <strong>${label}</strong></p><p>شكراً على مشاركتك في حماية خزنة Auryx.</p>`));
  } catch (err) {
    next(err);
  }
});

// ── POST /api/pin-reset/verify-otp ───────────────────────────────────────────
router.post('/verify-otp', requireAuth, requireVaultParticipant(), async (req, res, next) => {
  try {
    const { ownerEmail, code } = req.body as { ownerEmail: string; code: string };
    if (!ownerEmail || !code) {
      res.status(400).json({ message: 'ownerEmail and code are required' });
      return;
    }

    // Verify OTP using the same 'pin-reset-owner' marker
    const otpResult = await verifyOtp(ownerEmail, 'pin-reset-owner', code);

    if (!otpResult.ok) {
      res.status(400).json({ success: false, error: 'رمز التحقق غير صحيح أو منتهي الصلاحية' });
      return;
    }

    // Generate a one-time reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    resetTokens.set(resetToken, {
      ownerEmail: ownerEmail.toLowerCase(),
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    });

    logger.info({ ownerEmail }, 'PIN-Reset: OTP verified, reset token issued');
    res.json({ success: true, resetToken });
  } catch (err) {
    next(err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── POST /api/pin-reset/complete ─────────────────────────────────────────────
router.post('/complete', requireAuth, requireVaultParticipant(), async (req, res, next) => {
  try {
    const { ownerEmail, resetToken } = req.body as { ownerEmail: string; resetToken: string };
    if (!ownerEmail || !resetToken) {
      res.status(400).json({ message: 'ownerEmail and resetToken are required' });
      return;
    }

    const tokenData = resetTokens.get(resetToken);
    if (!tokenData || tokenData.ownerEmail !== ownerEmail.toLowerCase() || Date.now() > tokenData.expiresAt) {
      res.status(403).json({ success: false, error: 'رمز إعادة التعيين غير صالح أو منتهي الصلاحية' });
      return;
    }

    // Invalidate the token immediately (one-time use)
    resetTokens.delete(resetToken);

    // Mark the request as completed in DB
    const pinReq = await getLatestPinResetRequest(ownerEmail);
    if (pinReq && pinReq.status === 'approved') {
      await completePinResetRequest(pinReq.id, 'completed');
      logger.info({ ownerEmail, requestId: pinReq.id }, 'PIN-Reset: process completed successfully');
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
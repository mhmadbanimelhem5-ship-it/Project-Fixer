/**
 * routes/vaultTransfer.ts
 *
 * Encrypted vault transfer endpoints (PostgreSQL-backed).
 *
 *   POST /api/vault/seal                    — owner uploads sealed vault package
 *   POST /api/vault/request-otp/:ownerEmail — generate + email a 6-digit OTP
 *   POST /api/vault/verify-otp/:ownerEmail  — verify OTP, return encrypted blob
 *   GET  /api/vault/shares/:ownerEmail      — beneficiary collects guardian shares
 *   GET  /api/vault/:ownerEmail             — retrieve full sealed vault
 *   POST /api/vault/share/:ownerEmail       — guardian submits decrypted Shamir share
 *
 * P1-2 hardening:
 *   - Dedicated per-ownerEmail rate limiter on request-otp to prevent
 *     authenticated email-bombing against a specific vault beneficiary.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  storeSealedVault,
  lookupSealedVault,
  submitGuardianShare,
  getCollectedShares,
  type GuardianPackage,
} from '../lib/keyStore';
import { generateOtp, verifyOtp, OTP_PURPOSES } from '../lib/otpStore';
import { sendWithRetry } from '../lib/emailService';
import { authLimiter } from '../middleware/rateLimit';
import { requireAuth, requireOwner, requireParticipant, requireVaultParticipant } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validation';
import {
  ownerEmailParams,
  sealVaultBody,
  otpRequestBody,
  otpVerifyBody,
  guardianShareBody,
} from '../middleware/schemas';

const router = Router();

// P1-2: per-ownerEmail rate limit on OTP request.
// Why not IP-only? An authenticated attacker can request OTPs from many IPs;
// what matters is how often a SPECIFIC vault's beneficiary gets emailed.
//   • 1 request / minute (cooldown) — prevents rapid-fire bombardment
//   • 5 requests / hour (budget)   — caps daily abuse even with retries
// The key function keys by ownerEmail so different vaults don't starve each other.
const otpRequestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.params.ownerEmail || '').toLowerCase(),
  message: { error: 'otp_cooldown', message: 'يرجى الانتظار 60 ثانية قبل طلب رمز جديد' },
  skipSuccessfulRequests: false,
});

const otpRequestHourlyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.params.ownerEmail || '').toLowerCase(),
  message: { error: 'otp_quota_exceeded', message: 'تم تجاوز الحد الأقصى من طلبات الرمز لهذه الساعة' },
});

// ── POST /api/vault/seal ──────────────────────────────────────────────────────
router.post('/seal', requireAuth, validateBody(sealVaultBody), requireOwner(), async (req, res, next) => {
  try {
    const {
      ownerEmail,
      beneficiaryEmail,
      encryptedBlob,
      benefEncryptedKey,
      guardianPackages,
      threshold,
    } = req.body as {
      ownerEmail: string;
      beneficiaryEmail: string;
      encryptedBlob: string;
      benefEncryptedKey?: string;
      guardianPackages: GuardianPackage[];
      threshold: number;
    };

    await storeSealedVault(ownerEmail, {
      encryptedBlob,
      beneficiaryEmail,
      benefEncryptedKey,
      guardianPackages,
      threshold,
      sealedAt: Date.now(),
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/vault/request-otp/:ownerEmail ───────────────────────────────────
router.post('/request-otp/:ownerEmail', requireAuth, authLimiter, otpRequestLimiter, otpRequestHourlyLimiter, validateParams(ownerEmailParams), validateBody(otpRequestBody), requireVaultParticipant(), async (req, res, next) => {
  try {
    const ownerEmail = String(req.params.ownerEmail);
    const { beneficiaryEmail, ownerName } = req.body as {
      beneficiaryEmail: string;
      ownerName?: string;
    };

    const vault = await lookupSealedVault(ownerEmail);
    if (!vault) {
      res.status(404).json({ message: 'No sealed vault found for this owner' });
      return;
    }
    if (vault.beneficiaryEmail !== beneficiaryEmail.trim().toLowerCase()) {
      res.status(403).json({ message: 'beneficiaryEmail does not match vault record' });
      return;
    }

    const otp = await generateOtp(ownerEmail, beneficiaryEmail, OTP_PURPOSES.beneficiaryTransfer);
    req.log.info({ ownerEmail, beneficiaryEmail }, 'Vault OTP generated');

    const emailResult = await sendWithRetry('otp-email', beneficiaryEmail, {
      ownerName: ownerName ?? ownerEmail,
      otp,
    });

    const emailSent = emailResult.success;
    if (emailSent) {
      req.log.info({ ownerEmail, beneficiaryEmail }, 'Vault OTP email sent successfully');
    } else {
      req.log.error({ ownerEmail, beneficiaryEmail, error: emailResult.error }, 'Failed to send vault OTP email after retries');
    }

    if (!emailSent) {
      res.status(502).json({
        success: false,
        error: 'otp_generated_email_failed',
        message: 'تم توليد الرمز لكن فشل إرسال الإيميل. تحقق من إعدادات البريد.',
      });
      return;
    }

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/vault/verify-otp/:ownerEmail ────────────────────────────────────
router.post('/verify-otp/:ownerEmail', requireAuth, authLimiter, validateParams(ownerEmailParams), validateBody(otpVerifyBody), requireVaultParticipant(), async (req, res, next) => {
  try {
    const ownerEmail = String(req.params.ownerEmail);
    const { beneficiaryEmail, otp } = req.body as {
      beneficiaryEmail: string;
      otp: string;
    };

    const result = await verifyOtp(ownerEmail, beneficiaryEmail, otp, OTP_PURPOSES.beneficiaryTransfer);
    if (!result.ok) {
      const status =
        result.reason === 'expired' ||
        result.reason === 'already_used' ||
        result.reason === 'max_attempts'
          ? 410
          : 401;
      res.status(status).json({ valid: false, reason: result.reason });
      return;
    }

    const vault = await lookupSealedVault(ownerEmail);
    if (!vault) {
      res.status(404).json({ valid: false, reason: 'vault_not_found' });
      return;
    }

    res.json({
      valid: true,
      encryptedBlob: vault.encryptedBlob,
      benefEncryptedKey: vault.benefEncryptedKey,
      ownerName: '',
      sealedAt: vault.sealedAt,
    });
  } catch (err) { next(err); }
});

// ── GET /api/vault/shares/:ownerEmail ─────────────────────────────────────────
router.get('/shares/:ownerEmail', requireAuth, validateParams(ownerEmailParams), requireVaultParticipant(), async (req, res, next) => {
  try {
    const result = await getCollectedShares(String(req.params.ownerEmail));
    if (!result) {
      res.status(404).json({ message: 'No sealed vault found for this owner' });
      return;
    }
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/vault/:ownerEmail ────────────────────────────────────────────────
router.get('/:ownerEmail', requireAuth, validateParams(ownerEmailParams), requireVaultParticipant(), async (req, res, next) => {
  try {
    const vault = await lookupSealedVault(String(req.params.ownerEmail));
    if (!vault) {
      res.status(404).json({ message: 'No sealed vault found for this owner' });
      return;
    }
    res.json(vault);
  } catch (err) { next(err); }
});

// ── POST /api/vault/share/:ownerEmail ─────────────────────────────────────────
router.post('/share/:ownerEmail', requireAuth, validateParams(ownerEmailParams), validateBody(guardianShareBody), requireVaultParticipant(), requireParticipant(['guardianEmail']), async (req, res, next) => {
  try {
    const { guardianEmail, encryptedShareForBeneficiary } = req.body as {
      guardianEmail: string;
      encryptedShareForBeneficiary: string;
    };

    const ownerEmail = String(req.params.ownerEmail);
    if (!await lookupSealedVault(ownerEmail)) {
      res.status(404).json({ message: 'No sealed vault found for this owner' });
      return;
    }

    await submitGuardianShare(ownerEmail, guardianEmail, encryptedShareForBeneficiary);
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
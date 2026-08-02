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
 */

import { Router } from 'express';
import {
  storeSealedVault,
  lookupSealedVault,
  submitGuardianShare,
  getCollectedShares,
  type GuardianPackage,
} from '../lib/keyStore';
import { generateOtp, verifyOtp } from '../lib/otpStore';
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
router.post('/request-otp/:ownerEmail', requireAuth, authLimiter, validateParams(ownerEmailParams), validateBody(otpRequestBody), requireVaultParticipant(), async (req, res, next) => {
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
    // Security: validate beneficiaryEmail matches the registered vault beneficiary,
    // to prevent sending OTP emails to arbitrary addresses.
    if (vault.beneficiaryEmail !== beneficiaryEmail.trim().toLowerCase()) {
      res.status(403).json({ message: 'beneficiaryEmail does not match vault record' });
      return;
    }

    const otp = await generateOtp(ownerEmail, beneficiaryEmail);
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
      // OTP was generated and is valid in DB, but the email failed.
      // Return a specific error so the client can alert the user.
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

    const result = await verifyOtp(ownerEmail, beneficiaryEmail, otp);
    if (!result.ok) {
      const status = result.reason === 'expired' || result.reason === 'already_used' ? 410 : 401;
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
// Must be declared BEFORE /:ownerEmail to avoid route collision.
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
    const { guardianEmail, rawShareHex } = req.body as {
      guardianEmail: string;
      rawShareHex: string;
    };

    const ownerEmail = String(req.params.ownerEmail);
    if (!await lookupSealedVault(ownerEmail)) {
      res.status(404).json({ message: 'No sealed vault found for this owner' });
      return;
    }

    await submitGuardianShare(ownerEmail, guardianEmail, rawShareHex);
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;

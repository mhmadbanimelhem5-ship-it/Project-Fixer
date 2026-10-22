/**
 * routes/cron.ts — Internal Scheduler Triggers
 *
 * These endpoints are called by Vercel Cron / GitHub Actions.
 * They MUST be protected by a secret token to prevent unauthorized triggering.
 */

import { Router } from 'express';
import { runAbsenceSchedulerTick } from './absence';
import { logger } from '../lib/logger';

const router = Router();

// ── GET /api/cron/absence-tick ───────────────────────────────────────────────
/**
 * Triggered periodically by GitHub Actions / Vercel Cron.
 * Checks for absent owners and sends notifications (Push first, Email fallback).
 *
 * Auth: accepts either:
 *  - Authorization: Bearer <CRON_SECRET>   (what Vercel/GitHub sends)
 *  - x-internal-secret: <CRON_SECRET>      (for manual testing)
 */
router.get('/absence-tick', async (req, res) => {
  // 1. SECURITY CHECK
  const authHeader = req.headers.authorization;
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    logger.error('CRON_SECRET is not set in environment variables! Blocking cron execution.');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const bearerOk = authHeader === `Bearer ${expectedSecret}`;
  const internalOk = req.get('x-internal-secret') === expectedSecret;

  if (!bearerOk && !internalOk) {
    logger.warn({ ip: req.ip }, 'Unauthorized attempt to trigger absence cron');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 2. EXECUTE THE SCHEDULER LOGIC
    logger.info('Cron triggered: Running absence scheduler tick...');

    const result = await runAbsenceSchedulerTick();

    return res.json({
      success: true,
      message: 'Absence scheduler completed',
      stats: result ?? null,
    });
  } catch (err) {
    logger.error({ err }, 'Absence scheduler crashed during cron execution');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
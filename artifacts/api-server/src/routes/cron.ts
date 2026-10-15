/**
 * routes/cron.ts — Internal Scheduler Triggers
 * 
 * These endpoints are called by Vercel Cron Jobs. They MUST be protected
 * by a secret token to prevent unauthorized users from triggering the scheduler manually.
 */

import { Router } from 'express';
import { runAbsenceSchedulerTick } from './absence'; // Import the exported function we just created
import { logger } from '../lib/logger';

const router = Router();

// ── GET /api/cron/absence-tick ───────────────────────────────────────────────
/**
 * Triggered every 3 minutes by Vercel Cron.
 * Checks for absent owners and sends notifications (Email/Push).
 */
router.get('/absence-tick', async (req, res) => {
  // 1. SECURITY CHECK: Verify the request comes from Vercel Cron
  const authHeader = req.headers.authorization;
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    logger.error('CRON_SECRET is not set in environment variables! Blocking cron execution.');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  if (authHeader !== `Bearer ${expectedSecret}`) {
    logger.warn({ ip: req.ip }, 'Unauthorized attempt to trigger absence cron');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 2. EXECUTE THE SCHEDULER LOGIC
    logger.info('Vercel Cron triggered: Running absence scheduler tick...');

    // We await this because Serverless functions have timeouts (usually 10s on Hobby).
    // Our logic inside runAbsenceSchedulerTick uses transactions which should be fast enough.
    const result = await runAbsenceSchedulerTick();

    res.json({ 
      success: true, 
      message: 'Absence scheduler completed',
      stats: result 
    });
  } catch (err) {
    logger.error({ err }, 'Absence scheduler crashed during cron execution');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
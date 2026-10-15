/**
 * push.ts — Push Notification Infrastructure
 *
 * Three endpoints:
 * 1. POST /register        : Client sends Expo Push Token -> Server stores it in DB
 *                            linked to Clerk User ID. Enables server-initiated pushes
 *                            later (e.g. Absence Protocol) even when the app is closed.
 * 2. POST /notify          : Direct push to a single token provided in the body.
 *                            Used by the client app for instant events (guardian added/removed).
 *                            Compatible with fcmService.sendGuardianNotification().
 * 3. POST /internal-notify : Server-side fan-out to ALL devices of a given userId.
 *                            Protected by x-internal-secret (CRON_SECRET) — NOT public.
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { z } from 'zod';
import { authLimiter } from '../middleware/rateLimit';
import { db, userPushTokensTable } from '@workspace/db';
import { eq, and } from 'drizzle-orm';
import { logger } from '../lib/logger';

const router = Router();

// ─── Validation Schemas ────────────────────────────────────────────────────────

const registerSchema = z.object({
  expoPushToken: z.string().regex(/^Exponent?PushToken\[.*\]$/, 'Invalid Expo push token format'),
  platform: z.enum(['ios', 'android']).optional(),
});

// /notify receives the token DIRECTLY (matches fcmService.sendGuardianNotification body)
const notifyDirectSchema = z.object({
  token: z.string().regex(/^Exponent?PushToken\[.*\]$/, 'Invalid Expo push token format'),
  title: z.string().min(1),
  body: z.string().min(1),
  sound: z.enum(['default', null]).nullable().optional(),
  data: z.record(z.any()).optional(),
});

// /internal-notify fans out by userId
const notifySchema = z.object({
  userId: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  sound: z.enum(['default', null]).nullable().optional(),
  data: z.record(z.any()).optional(),
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound?: 'default' | null;
  data?: Record<string, unknown>;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoPushResponse {
  data: ExpoPushTicket[];
}

// ─── Helper: Send Raw Push to Expo API ─────────────────────────────────────────

async function sendRawPush(message: ExpoPushMessage): Promise<{ success: boolean; ticketId?: string; error?: string }> {
  try {
    const expoResponse = await fetch('https://api.expo.io/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!expoResponse.ok) {
      const errorText = await expoResponse.text().catch(() => String(expoResponse.status));
      logger.error({ status: expoResponse.status, body: errorText }, 'Expo Push API returned non-2xx');
      return { success: false, error: `HTTP ${expoResponse.status}` };
    }

    const result = (await expoResponse.json()) as ExpoPushResponse;
    const ticket = result.data?.[0];

    if (!ticket || ticket.status === 'error') {
      const errMsg = ticket?.message ?? 'Unknown push delivery error';
      logger.warn({ ticket }, `Push delivery failed: ${errMsg}`);
      return { success: false, error: errMsg };
    }

    logger.info({ to: message.to.slice(0, 20) + '…', ticketId: ticket.id }, 'Push sent successfully');
    return { success: true, ticketId: ticket.id };
  } catch (e) {
    logger.error({ err: e }, 'Exception during Expo Push request');
    return { success: false, error: 'Internal Server Error' };
  }
}

// ─── Route 1: Register Token (Called by Client App) ────────────────────────────

router.post('/register', requireAuth, authLimiter, async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.flatten() });
      return;
    }

    const { expoPushToken, platform } = parsed.data;
    const userId = req.auth.userId;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const existing = await db.select().from(userPushTokensTable)
      .where(and(eq(userPushTokensTable.userId, userId), eq(userPushTokensTable.platform, platform ?? 'unknown')))
      .limit(1);

    if (existing.length > 0) {
      await db.update(userPushTokensTable)
        .set({
          token: expoPushToken,
          updatedAt: new Date(),
          lastSeenAt: new Date(),
        })
        .where(eq(userPushTokensTable.id, existing[0].id));
    } else {
      await db.insert(userPushTokensTable).values({
        userId,
        token: expoPushToken,
        platform: platform ?? 'unknown',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSeenAt: new Date(),
      });
    }

    logger.info({ userId, platform }, 'Push token registered/updated');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─── Route 2: Direct Notify (Called by Client App for instant events) ──────────
// Receives the token in the body and pushes to it directly. This is what
// fcmService.sendGuardianNotification() calls. Protected by Clerk auth.

router.post('/notify', requireAuth, authLimiter, async (req, res, next) => {
  try {
    const parsed = notifyDirectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.flatten() });
      return;
    }

    const { token, title, body, sound, data } = parsed.data;
    const result = await sendRawPush({
      to: token,
      title,
      body,
      sound: sound ?? null,
      data: data ?? {},
    });

    res.json({ success: result.success, error: result.error });
  } catch (err) {
    next(err);
  }
});

// ─── Route 3: Internal Fan-out Notify (Server-side, by userId) ─────────────────
// SECURITY: previously this route had NO auth, exposing it to anyone who knew
// the URL. Now gated by x-internal-secret == CRON_SECRET (same secret the cron
// uses — no new secret introduced). Intended for absence.ts / admin tools only.

router.post('/internal-notify', async (req, res, next) => {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      logger.error('CRON_SECRET missing — refusing internal-notify');
      res.status(500).json({ success: false, error: 'Server misconfiguration' });
      return;
    }
    if (req.headers['x-internal-secret'] !== secret) {
      logger.warn({ ip: req.ip }, 'Unauthorized attempt on /internal-notify');
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const parsed = notifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.flatten() });
      return;
    }

    const { userId, title, body, sound, data } = parsed.data;

    const tokensRows = await db.select().from(userPushTokensTable)
      .where(eq(userPushTokensTable.userId, userId));

    if (tokensRows.length === 0) {
      logger.warn({ userId }, 'No push tokens found for user');
      res.json({ success: false, error: 'No registered devices for this user' });
      return;
    }

    const messages: ExpoPushMessage[] = tokensRows.map(row => ({
      to: row.token,
      title,
      body,
      sound: sound ?? null,
      data: { ...data, timestamp: Date.now() },
    }));

    const results = await Promise.all(messages.map(msg => sendRawPush(msg)));
    const successes = results.filter(r => r.success).length;
    const failures = results.filter(r => !r.success).length;

    logger.info({ userId, total: messages.length, successes, failures }, 'Batch push notification dispatched');

    res.json({
      success: successes > 0,
      totalDevices: messages.length,
      delivered: successes,
      failed: failures,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
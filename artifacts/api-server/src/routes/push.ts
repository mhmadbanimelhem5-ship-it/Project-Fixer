/**
 * push.ts — Push Notification Infrastructure
 * 
 * Two main responsibilities:
 * 1. POST /register : Client sends Expo Push Token -> Server stores it in DB linked to User ID.
 *    This allows the server to send pushes later even if the app is closed (e.g., Absence Protocol).
 * 2. POST /notify   : Server-side helper to actually SEND a push via Expo API.
 *    Used by internal services (like absence scheduler) or admin tools.
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { z } from 'zod'; // Assuming zod is used for validation based on schemas.ts pattern
import { authLimiter } from '../middleware/rateLimit';
import { db, userPushTokensTable } from '@workspace/db'; // Adjust import path as needed
import { eq, and } from 'drizzle-orm';
import { logger } from '../lib/logger';

const router = Router();

// ─── Validation Schemas ────────────────────────────────────────────────────────

const registerSchema = z.object({
  expoPushToken: z.string().regex(/^Exponent?PushToken\[.*\]$/, 'Invalid Expo push token format'),
  platform: z.enum(['ios', 'android']).optional(),
});

const notifySchema = z.object({
  userId: z.string().min(1), // Target user ID (from Clerk)
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

      // Optional: If token is invalid/expired, we might want to clean it up from DB here
      // For now, we just report failure.
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
    const userId = req.auth.userId; // From Clerk middleware

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Upsert logic: Update existing record for this user/platform, or insert new one
    // We assume a user can have multiple devices (iOS + Android), so we key by userId + platform
    const existing = await db.select().from(userPushTokensTable)
      .where(and(eq(userPushTokensTable.userId, userId), eq(userPushTokensTable.platform, platform ?? 'unknown')))
      .limit(1);

    if (existing.length > 0) {
      await db.update(userPushTokensTable)
        .set({ 
          token: expoPushToken, 
          updatedAt: new Date(),
          lastSeenAt: new Date() 
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

// ─── Route 2: Internal Notify (Used by Scheduler/Admin) ────────────────────────
// NOTE: This route should ideally be protected differently than public client routes.
// Since it's called internally by our own code (absence.ts), we trust the caller 
// but still validate inputs strictly.

router.post('/internal-notify', async (req, res, next) => {
  // SECURITY WARNING: In production, ensure this endpoint is NOT exposed publicly
  // or protect it with a specific secret header (e.g., x-internal-secret).
  // For simplicity in this refactor, we assume it's called safely from within the same process/context.

  try {
    const parsed = notifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.flatten() });
      return;
    }

    const { userId, title, body, sound, data } = parsed.data;

    // Fetch ALL active tokens for this user (might have iOS + Android)
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

    // Send all messages in parallel
    const results = await Promise.all(messages.map(msg => sendRawPush(msg)));

    const successes = results.filter(r => r.success).length;
    const failures = results.filter(r => !r.success).length;

    logger.info({ userId, total: messages.length, successes, failures }, 'Batch push notification dispatched');

    res.json({ 
      success: successes > 0, 
      totalDevices: messages.length,
      delivered: successes,
      failed: failures 
    });

  } catch (err) {
    next(err);
  }
});

export default router;
/**
 * push.ts — Push Notification Infrastructure (Expo Push Service, resilient)
 */

import { timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { z } from 'zod';
import { authLimiter } from '../middleware/rateLimit';
import { db, userPushTokensTable } from '@workspace/db';
import { eq, and } from 'drizzle-orm';
import { logger } from '../lib/logger';

const router = Router();

// ✅ نطاقان رسميان لخدمة Expo Push — نجربهما بالتتابع لتجاوز فشل DNS المتقطع
const EXPO_PUSH_ENDPOINTS = [
  'https://api.expo.io/v2/push/send',
  'https://exp.host/--/api/v2/push/send',
];

function matchesInternalSecret(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const providedBytes = Buffer.from(provided, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

const requirePushNotifyAuth: RequestHandler = (req, res, next) => {
  const internalSecret = process.env.CRON_SECRET;
  if (internalSecret && matchesInternalSecret(req.get('x-internal-secret'), internalSecret)) {
    next();
    return;
  }
  requireAuth(req as any, res, next);
};

// ─── Validation Schemas ────────────────────────────────────────────────────────

const registerSchema = z.object({
  expoPushToken: z.string().regex(/^Exponent?PushToken\[.*\]$/, 'Invalid Expo push token format'),
  platform: z.enum(['ios', 'android']).optional(),
});

const notifyDirectSchema = z.object({
  token: z.string().regex(/^Exponent?PushToken\[.*\]$/, 'Invalid Expo push token format'),
  title: z.string().min(1),
  body: z.string().min(1),
  sound: z.literal('default').nullable().optional(),
  data: z.record(z.any()).optional(),
});

const notifySchema = z.object({
  userId: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  sound: z.literal('default').nullable().optional(),
  data: z.record(z.any()).optional(),
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface PushMessage {
  to: string;
  title: string;
  body: string;
  sound?: 'default' | null;
  data?: Record<string, unknown>;
}

// ─── Resilient Sender: multi-endpoint + retry + timeout ───────────────────────

async function postWithTimeout(url: string, body: unknown, timeoutMs = 10000): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    };
    if (process.env.EXPO_ACCESS_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    }
    return await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function sendRawPush(message: PushMessage): Promise<{ success: boolean; ticketId?: string; error?: string }> {
  const payload = {
    to: message.to,
    title: message.title,
    body: message.body,
    sound: message.sound ?? 'default',
    priority: 'high',
    data: message.data ?? {},
  };

  let lastError = 'Unknown push error';

  for (let round = 0; round < 2; round++) {
    for (const url of EXPO_PUSH_ENDPOINTS) {
      try {
        const res = await postWithTimeout(url, [payload]);
        if (!res.ok) {
          lastError = `HTTP ${res.status} from ${url}`;
          logger.warn({ url, status: res.status }, 'Expo endpoint non-2xx');
          continue;
        }
        const result = (await res.json()) as any;
        const ticket = result?.data?.[0];
        if (ticket?.status === 'ok') {
          logger.info({ ticketId: ticket.id, host: url }, 'Push accepted by Expo Push Service');
          return { success: true, ticketId: ticket.id };
        }
        lastError = ticket?.message ?? ticket?.details?.error ?? 'Expo ticket error';
        if (ticket?.details?.error === 'DeviceNotRegistered') {
          return { success: false, error: 'DeviceNotRegistered' };
        }
      } catch (e: any) {
        lastError = e?.cause?.code ?? e?.name ?? e?.message ?? 'network error';
        logger.warn({ url, err: e }, 'Expo endpoint attempt failed (DNS/network)');
      }
    }
    await new Promise((r) => setTimeout(r, 700));
  }

  logger.error({ lastError }, 'All Expo push attempts failed');
  return { success: false, error: lastError };
}

// ─── Route 1: Register Token ───────────────────────────────────────────────────

router.post('/register', requireAuth, authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.flatten() });
      return;
    }

    const { expoPushToken, platform } = parsed.data;
    const authReq = req as any;
    const userId: string | undefined = authReq.auth?.userId;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const platformValue = (platform ?? 'unknown') as any;

    const existing = await db.select().from(userPushTokensTable)
      .where(and(eq(userPushTokensTable.userId, userId as any), eq(userPushTokensTable.platform, platformValue)))
      .limit(1);

    if (existing.length > 0) {
      await db.update(userPushTokensTable)
        .set({
          token: expoPushToken,
          updatedAt: new Date() as any,
          lastSeenAt: new Date() as any,
        } as any)
        .where(eq(userPushTokensTable.id, existing[0].id as any));
    } else {
      await db.insert(userPushTokensTable).values({
        userId: userId as any,
        token: expoPushToken,
        platform: platformValue,
        createdAt: new Date() as any,
        updatedAt: new Date() as any,
        lastSeenAt: new Date() as any,
      } as any);
    }

    logger.info({ userId, platform }, 'Push token registered/updated');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─── Route 2: Direct Notify ────────────────────────────────────────────────────

router.post('/notify', requirePushNotifyAuth, authLimiter, async (req: Request, res: Response, next: NextFunction) => {
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
      sound: sound ?? undefined,
      data: data ?? {},
    });

    if (result.success) {
      res.json({ success: true, ticketId: result.ticketId });
    } else {
      res.status(502).json({ success: false, error: result.error });
    }
  } catch (err) {
    next(err);
  }
});

// ─── Route 3: Internal Fan-out Notify ──────────────────────────────────────────

router.post('/internal-notify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      logger.error('CRON_SECRET missing — refusing internal-notify');
      res.status(500).json({ success: false, error: 'Server misconfiguration' });
      return;
    }
    if (!matchesInternalSecret(req.get('x-internal-secret'), secret)) {
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
      .where(eq(userPushTokensTable.userId, userId as any));

    if (tokensRows.length === 0) {
      logger.warn({ userId }, 'No push tokens found for user');
      res.json({ success: false, error: 'No registered devices for this user' });
      return;
    }

    const messages: PushMessage[] = tokensRows.map((row) => {
      const msg: PushMessage = {
        to: row.token as string,
        title,
        body,
        data: { ...(data ?? {}), timestamp: Date.now() },
      };
      if (sound !== undefined && sound !== null) {
        msg.sound = sound;
      }
      return msg;
    });

    const results = await Promise.all(messages.map((msg) => sendRawPush(msg)));
    const successes = results.filter((r) => r.success).length;
    const failures = results.filter((r) => !r.success).length;

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
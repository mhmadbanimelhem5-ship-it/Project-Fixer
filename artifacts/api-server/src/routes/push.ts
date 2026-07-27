/**
 * push.ts — POST /api/push/notify
 *
 * Sends a push notification via the Expo Push Notification Service,
 * which delivers through Firebase Cloud Messaging (FCM) on Android
 * and APNs on iOS.
 *
 * Server-side logs:
 *   Success: "تم إرسال إشعار بنجاح"
 *   Failure: "فشل إرسال الإشعار – تحقق من إعدادات Firebase"
 */

import { Router } from 'express';

const router = Router();

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default' | null;
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

function isValidExpoPushToken(token: string): boolean {
  return (
    token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[')
  );
}

router.post('/notify', async (req, res, next) => {
  try {
    const { token, title, body } = req.body as {
      token?: unknown;
      title?: unknown;
      body?: unknown;
    };

    if (
      typeof token !== 'string' ||
      typeof title !== 'string' ||
      typeof body !== 'string' ||
      !token.trim() ||
      !title.trim() ||
      !body.trim()
    ) {
      res.status(400).json({ success: false, error: 'token, title, and body are required strings' });
      return;
    }

    if (!isValidExpoPushToken(token)) {
      res.status(400).json({ success: false, error: 'Invalid Expo push token format' });
      return;
    }

    const message: ExpoPushMessage = {
      to: token,
      title,
      body,
      sound: 'default',
      data: { timestamp: Date.now(), app: 'auryx' },
    };

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
      req.log.error(
        { status: expoResponse.status, body: errorText },
        'فشل إرسال الإشعار – تحقق من إعدادات Firebase: Expo Push API returned non-2xx',
      );
      res.status(502).json({ success: false, error: `Expo Push API error: ${expoResponse.status}` });
      return;
    }

    const result = (await expoResponse.json()) as ExpoPushResponse;
    const ticket = result.data?.[0];

    if (!ticket || ticket.status === 'error') {
      const errMsg = ticket?.message ?? 'Unknown push delivery error';
      req.log.warn(
        { ticket },
        `فشل إرسال الإشعار – تحقق من إعدادات Firebase: ${errMsg}`,
      );
      res.status(200).json({ success: false, error: errMsg });
      return;
    }

    req.log.info(
      { to: token.slice(0, 40) + '…', title, ticketId: ticket.id },
      'تم إرسال إشعار بنجاح',
    );
    res.json({ success: true, ticketId: ticket.id });
  } catch (e) {
    next(e);
  }
});

export default router;

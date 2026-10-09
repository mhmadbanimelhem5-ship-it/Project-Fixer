import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { subscriptionsTable } from "@workspace/db/schema";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

type RevenueCatEvent = Record<string, unknown> & {
  app_user_id?: unknown;
  user_id?: unknown;
  type?: unknown;
  event_type?: unknown;
  product_id?: unknown;
  product_ids?: unknown;
  purchase_token?: unknown;
  transaction_id?: unknown;
  expiration_at_ms?: unknown;
};

function parseSignatureHeader(header: string): { timestamp: number; signature: string } | null {
  const parts = new Map(
    header.split(",").map((part) => {
      const separator = part.indexOf("=");
      return separator < 0
        ? [part.trim(), ""]
        : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    }),
  );
  const timestampText = parts.get("t");
  const signature = parts.get("v1");
  if (!timestampText || !/^\d+$/.test(timestampText) || !signature || !/^[a-f\d]{64}$/i.test(signature)) {
    return null;
  }
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp)) return null;
  return { timestamp, signature };
}

function isValidSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const signedBody = Buffer.concat([Buffer.from(`${parsed.timestamp}.`, "utf8"), rawBody]);
  const expected = createHmac("sha256", secret).update(signedBody).digest();
  const received = Buffer.from(parsed.signature, "hex");
  return received.length === expected.length && timingSafeEqual(expected, received);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function eventFromPayload(payload: unknown): RevenueCatEvent | null {
  const root = asRecord(payload);
  if (!root) return null;

  const nestedPayload = asRecord(root.payload);
  const data = asRecord(root.data);
  const candidates = [
    asRecord(root.event),
    asRecord(nestedPayload?.event),
    asRecord(data?.event),
    nestedPayload,
    data,
    root,
  ].filter((candidate): candidate is Record<string, unknown> => candidate !== null);

  const event = candidates.find((candidate) =>
    typeof candidate.type === "string" || typeof candidate.event_type === "string",
  );
  return (event ?? null) as RevenueCatEvent | null;
}

function firstString(...values: unknown[]): string | null {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

function productName(event: RevenueCatEvent): string | null {
  if (typeof event.product_id === "string") return event.product_id;
  if (Array.isArray(event.product_ids) && typeof event.product_ids[0] === "string") {
    return event.product_ids[0];
  }
  return null;
}

/**
 * POST /subscriptions/webhook
 * يستقبل إشعارات RevenueCat ويحدّث جدول الاشتراكات.
 */
router.post("/webhook", async (req, res) => {
  try {
    const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
    if (!secret) {
      logger.error("REVENUECAT_WEBHOOK_SECRET is not configured");
      return res.status(503).json({ error: "Webhook authentication is not configured" });
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
    const signature = req.get("x-revenuecat-webhook-signature");
    if (!rawBody || !isValidSignature(rawBody, signature, secret)) {
      logger.warn(
        { hasRawBody: Boolean(rawBody), hasSignature: Boolean(signature) },
        "RevenueCat webhook signature rejected",
      );
      return res.status(401).json({ error: "Invalid webhook signature" });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      logger.warn({ bodyBytes: rawBody.length }, "RevenueCat webhook JSON parsing failed");
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    const eventData = eventFromPayload(payload);
    const root = asRecord(payload);
    const nestedPayload = asRecord(root?.payload);
    const data = asRecord(root?.data);
    const userId = firstString(
      eventData?.app_user_id,
      eventData?.user_id,
      root?.app_user_id,
      root?.user_id,
      nestedPayload?.app_user_id,
      nestedPayload?.user_id,
      data?.app_user_id,
      data?.user_id,
    );
    const eventType = firstString(eventData?.type, eventData?.event_type)?.toUpperCase() ?? null;

    // Dashboard test events are signed, valid webhook requests, but should
    // never create or modify a production subscription record.
    if (eventType === "TEST") {
      logger.info("RevenueCat test webhook acknowledged");
      return res.status(200).json({ received: true });
    }

    if (!eventData || !userId || !eventType) {
      logger.warn(
        {
          payloadParsed: true,
          hasEvent: Boolean(eventData),
          hasUserId: Boolean(userId),
          hasEventType: Boolean(eventType),
        },
        "RevenueCat webhook payload rejected",
      );
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    let plan: string | null = null;
    let status: string | null = null;
    let providerToken: string | null = null;
    let currentPeriodEnd: number | null = null;

    switch (eventType) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
        plan = productName(eventData)?.toLowerCase().match(/year|annual/) ? "yearly" : "monthly";
        status = "active";
        providerToken = firstString(eventData.purchase_token, eventData.transaction_id);
        currentPeriodEnd = typeof eventData.expiration_at_ms === "number"
          ? Math.floor(eventData.expiration_at_ms / 1000)
          : null;
        break;

      case "CANCELLATION":
        status = "canceled";
        break;

      case "EXPIRATION":
        status = "expired";
        break;

      case "NON_RENEWING_PURCHASE":
        plan = productName(eventData)?.toLowerCase().match(/year|annual/) ? "yearly" : "monthly";
        status = "grace_period";
        break;

      default:
        logger.info({ eventType }, "Unhandled RevenueCat event type");
        return res.status(200).json({ received: true });
    }

    const now = Math.floor(Date.now() / 1000);

    if (plan && status) {
      await db
        .insert(subscriptionsTable)
        .values({
          userId,
          plan,
          status,
          providerToken,
          currentPeriodEnd,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: subscriptionsTable.userId,
          set: {
            plan,
            status,
            providerToken,
            currentPeriodEnd,
            updatedAt: now,
          },
        });
    } else {
      await db
        .update(subscriptionsTable)
        .set({
          ...(status && { status }),
          updatedAt: now,
        })
        .where(eq(subscriptionsTable.userId, userId));
    }

    logger.info({ eventType, status }, "Subscription webhook processed");
    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error({ error }, "Failed to process subscription webhook");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
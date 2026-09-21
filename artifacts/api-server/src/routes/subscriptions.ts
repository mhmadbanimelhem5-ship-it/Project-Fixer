import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { subscriptionsTable } from "@workspace/db"; // ← صح
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/**
 * POST /subscriptions/webhook
 * يستقبل إشعارات RevenueCat ويحدّث جدول الاشتراكات.
 */
router.post("/webhook", async (req, res) => {
  try {
    const event = req.body;

    // نتأكد إنه حدث اشتراك صالح من RevenueCat
    if (!event || !event.event_type || !event.user_id) {
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    const userId = event.user_id;
    const eventType = event.event_type;

    let plan: string | null = null;
    let status: string | null = null;
    let providerToken: string | null = null;
    let currentPeriodEnd: number | null = null;

    switch (eventType) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
        plan = event.product_ids?.[0]?.includes("yearly") ? "yearly" : "monthly";
        status = "active";
        providerToken = event.purchase_token ?? null;
        currentPeriodEnd = event.expiration_at_ms
          ? Math.floor(event.expiration_at_ms / 1000)
          : null;
        break;

      case "CANCELLATION":
        status = "canceled";
        break;

      case "EXPIRATION":
        status = "expired";
        break;

      case "NON_RENEWING_PURCHASE":
        plan = event.product_ids?.[0]?.includes("yearly") ? "yearly" : "monthly";
        status = "grace_period";
        break;

      default:
        logger.info({ eventType }, "Unhandled RevenueCat event type");
        return res.json({ received: true });
    }

    // Upsert: إذا المستخدم موجود → حدّث، وإذا لا → أدخل جديد
    const existing = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);

    const now = Math.floor(Date.now() / 1000);

    if (existing.length > 0) {
      await db
        .update(subscriptionsTable)
        .set({
          ...(plan && { plan }),
          ...(status && { status }),
          ...(providerToken !== undefined && { providerToken }),
          ...(currentPeriodEnd !== undefined && { currentPeriodEnd }),
          updatedAt: now,
        })
        .where(eq(subscriptionsTable.userId, userId));
    } else {
      // ما ندخل صف إلا لو فيه خطة وحالة واضحة
      if (plan && status) {
        await db.insert(subscriptionsTable).values({
          userId,
          plan,
          status,
          providerToken,
          currentPeriodEnd,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    logger.info({ userId, eventType, status }, "Subscription webhook processed");
    return res.json({ received: true });
  } catch (error) {
    logger.error({ error }, "Failed to process subscription webhook");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
import crypto from "node:crypto";
import { Router } from "express";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import {
  ConfirmWaitlistEmailParams,
  RegisterWaitlistBody,
} from "@workspace/api-zod";
import {
  db,
  waitlistEntriesTable,
  waitlistVerificationsTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { validateBody, validateParams } from "../middleware/validation";
import { waitlistLimiter } from "../middleware/rateLimit";
import { sendWithRetry } from "../lib/emailService";

const router = Router();
const CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;
const LAUNCH_DISCOUNT_PERCENT = 50;
const LAUNCH_LIMIT = 500;
const WAITLIST_LOCK_ID = 43;
const waitlistRegistrationSchema = RegisterWaitlistBody.refine(
  (value) => value.privacyAccepted === true,
  { message: "privacyAccepted must be true", path: ["privacyAccepted"] },
);

function getBaseUrl(): string {
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) return `https://${domains.split(",")[0].trim()}`;
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) return `https://${devDomain}`;
  return "http://localhost:80";
}

function page(title: string, icon: string, body: string): string {
  return `<!DOCTYPE html><html dir="rtl" lang="ar">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — Auryx</title>
  <style>
    *{box-sizing:border-box}body{background:#0A0F1E;color:#E2E8F0;font-family:Arial,Helvetica,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:rgba(255,255,255,.05);border:1px solid rgba(212,175,55,.25);border-radius:20px;max-width:500px;width:100%;padding:44px 36px;text-align:center}.logo{font-size:24px;font-weight:700;color:#D4AF37;letter-spacing:3px;margin-bottom:6px}.tagline{font-size:12px;color:#64748B;margin-bottom:36px}.icon{font-size:56px;margin-bottom:18px;line-height:1}h1{font-size:22px;margin:0 0 14px}p{font-size:14px;color:#CBD5E1;line-height:1.8;margin:0 0 10px}.hint{font-size:12px;color:#64748B}.footer{margin-top:30px;font-size:11px;color:#334155}
  </style></head><body><div class="card"><div class="logo">⬡ Auryx</div><div class="tagline">عالمك. محمي للأبد.</div><div class="icon">${icon}</div><h1>${title}</h1>${body}<div class="footer">هذا رد تلقائي من Auryx.</div></div></body></html>`;
}

function formatEligibility(row: typeof waitlistEntriesTable.$inferSelect | undefined) {
  const confirmed = Boolean(row?.confirmedAt);
  return {
    confirmed,
    eligible: Boolean(row?.confirmationRank && row.confirmationRank <= LAUNCH_LIMIT),
    confirmationRank: row?.confirmationRank ?? null,
    discountPercent: row?.discountPercent ?? 0,
    planPrices: { monthly: 5.99, annual: 45.99 },
  };
}

async function confirmEntry(token: string) {
  const now = Date.now();

  return db.transaction(async (tx) => {
    const tokens = await tx
      .select()
      .from(waitlistVerificationsTable)
      .where(
        and(
          eq(waitlistVerificationsTable.token, token),
          isNull(waitlistVerificationsTable.usedAt),
          gt(waitlistVerificationsTable.expiresAt, now),
        ),
      )
      .limit(1);
    const verification = tokens[0];
    if (!verification) return { status: "invalid" as const };

    await tx.execute(sql`SELECT pg_advisory_xact_lock(${WAITLIST_LOCK_ID})`);

    const entries = await tx
      .select()
      .from(waitlistEntriesTable)
      .where(eq(waitlistEntriesTable.email, verification.email))
      .limit(1);
    const entry = entries[0];
    if (!entry) return { status: "invalid" as const };

    let confirmedEntry = entry;
    if (!entry.confirmedAt) {
      const countRows = await tx.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM waitlist_entries WHERE confirmed_at IS NOT NULL`,
      );
      const confirmedCount = Number(countRows.rows[0]?.count ?? 0);
      const confirmationRank = confirmedCount + 1;
      const [updated] = await tx
        .update(waitlistEntriesTable)
        .set({
          confirmedAt: now,
          confirmationRank,
          discountPercent:
            confirmationRank <= LAUNCH_LIMIT ? LAUNCH_DISCOUNT_PERCENT : 0,
          updatedAt: now,
        })
        .where(eq(waitlistEntriesTable.email, entry.email))
        .returning();
      confirmedEntry = updated;
    }

    await tx
      .update(waitlistVerificationsTable)
      .set({ usedAt: now })
      .where(eq(waitlistVerificationsTable.token, token));

    return { status: "confirmed" as const, entry: confirmedEntry };
  });
}

router.post(
  "/register",
  waitlistLimiter,
  validateBody(waitlistRegistrationSchema),
  async (req, res, next): Promise<void> => {
    try {
      const email = req.body.email as string;
      const source = req.body.source as string;
      const now = Date.now();
      const token = crypto.randomBytes(32).toString("hex");

      const existingRows = await db
        .select()
        .from(waitlistEntriesTable)
        .where(eq(waitlistEntriesTable.email, email))
        .limit(1);
      const existing = existingRows[0];

      if (existing?.confirmedAt) {
        res.json({
          accepted: true,
          message: "هذا البريد مؤكد مسبقًا في قائمة الانتظار.",
          alreadyConfirmed: true,
          eligible: Boolean(
            existing.confirmationRank &&
              existing.confirmationRank <= LAUNCH_LIMIT,
          ),
          discountPercent: existing.discountPercent,
        });
        return;
      }

      if (existing) {
        await db
          .update(waitlistEntriesTable)
          .set({ source, privacyAccepted: true, updatedAt: now })
          .where(eq(waitlistEntriesTable.email, email));
      } else {
        await db.insert(waitlistEntriesTable).values({
          email,
          source,
          privacyAccepted: true,
          createdAt: now,
          updatedAt: now,
        });
      }

      await db.insert(waitlistVerificationsTable).values({
        token,
        email,
        createdAt: now,
        expiresAt: now + CONFIRMATION_TTL_MS,
      });

      const verificationUrl = `${getBaseUrl()}/api/waitlist/confirm/${token}`;
      const emailResult = await sendWithRetry(
        "waitlist-verification",
        email,
        { verificationUrl },
      );
      if (!emailResult.success) {
        res.status(502).json({
          accepted: false,
          message: "تعذر إرسال رسالة التأكيد. حاول مرة أخرى لاحقًا.",
        });
        return;
      }

      res.json({
        accepted: true,
        message: "تحقق من بريدك الإلكتروني لتأكيد تسجيلك.",
        alreadyConfirmed: false,
        eligible: false,
        discountPercent: 0,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/confirm/:token",
  validateParams(ConfirmWaitlistEmailParams),
  async (req, res, next): Promise<void> => {
    try {
      const result = await confirmEntry(req.params.token as string);
      if (result.status === "invalid") {
        res
          .status(410)
          .send(page("رابط غير صالح", "❌", "<p>انتهت صلاحية رابط التأكيد أو تم استخدامه مسبقًا.</p>"));
        return;
      }

      const eligibility = formatEligibility(result.entry);
      const offer = eligibility.eligible
        ? "<p>أنت ضمن أول 500 شخص، وحصلت على <strong>خصم 50% مدى الحياة</strong>.</p>"
        : "<p>تم تأكيد بريدك، لكن المقاعد المخفضة اكتملت.</p>";
      res.send(
        page(
          "تم تأكيد البريد",
          "✅",
          `${offer}<p class="hint">استخدم نفس البريد عند إنشاء حسابك داخل تطبيق Auryx.</p>`,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/me",
  requireAuth,
  async (req, res, next): Promise<void> => {
    try {
      const userEmail = (req as AuthenticatedRequest).authUser?.email;
      if (!userEmail) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const rows = await db
        .select()
        .from(waitlistEntriesTable)
        .where(eq(waitlistEntriesTable.email, userEmail))
        .limit(1);
      res.json(formatEligibility(rows[0]));
    } catch (error) {
      next(error);
    }
  },
);

export default router;

async function cleanupWaitlistVerifications(): Promise<void> {
  const deleted = await db
    .delete(waitlistVerificationsTable)
    .where(lt(waitlistVerificationsTable.expiresAt, Date.now()))
    .returning({ token: waitlistVerificationsTable.token });
  if (deleted.length > 0) {
    console.info("Expired waitlist verification tokens cleaned up", {
      deleted: deleted.length,
    });
  }
}

setInterval(() => {
  cleanupWaitlistVerifications().catch((error) => {
    console.error("Waitlist verification cleanup failed", error);
  });
}, 24 * 60 * 60 * 1000);

cleanupWaitlistVerifications().catch((error) => {
  console.error("Initial waitlist verification cleanup failed", error);
});
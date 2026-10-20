import express, { type ErrorRequestHandler, type Express, type Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { z } from "zod";
import { db, userPushTokensTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import router from "./routes";
import cronRouter from "./routes/cron"; 
import { logger } from "./lib/logger";
import { generalLimiter } from "./middleware/rateLimit";
import { clerkMiddleware } from "@clerk/express";
import { clerkProxyMiddleware, CLERK_PROXY_PATH } from "./middleware/clerkProxyMiddleware";
import * as admin from "firebase-admin";

// ✅ تهيئة Firebase Admin مرة واحدة فقط بأمان
if (!admin.apps || admin.apps.length === 0) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("✅ Firebase Admin initialized successfully");
  } catch (error) {
    console.error("❌ Failed to initialize Firebase Admin:", error);
  }
}

const app: Express = express();
app.set("trust proxy", 1);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(clerkMiddleware());
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

const allowedOrigins = new Set(
  [
    process.env.WEB_APP_ORIGIN,
    process.env.REPLIT_DEV_DOMAIN,
    process.env.REPLIT_DOMAINS,
    "https://getauryx.com",
    "https://www.getauryx.com",
  ]
    .flatMap((value) => (value ? value.split(",") : []))
    .map((value) => (value.startsWith("http") ? value : `https://${value}`))
    .map((value) => value.replace(/\/+$/, "")),
);

const isLocalDevelopmentOrigin = (origin: string): boolean =>
  /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin) || isLocalDevelopmentOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("origin_not_allowed"));
  },
  credentials: true,
}));

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

app.use("/api/subscriptions/webhook", express.raw({ type: "application/json", limit: "1mb", inflate: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/api/", generalLimiter);
app.use("/api/cron", cronRouter);

// ═══════════════════════════════════════════════════════════════════════════
// INLINE PUSH ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.post("/api/push/register", async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      expoPushToken: z.string().min(1),
      platform: z.enum(["ios", "android"]).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Invalid payload" });
      return;
    }
    const { expoPushToken, platform } = parsed.data;

    const authReq = req as unknown as { auth?: { userId: string } };
    const userId = authReq.auth?.userId || "temp-debug-user-id";

    const now = new Date();
    const existing = await db.select().from(userPushTokensTable)
      .where(and(eq(userPushTokensTable.userId, userId), eq(userPushTokensTable.platform, platform ?? "unknown")))
      .limit(1);

    if (existing.length > 0) {
      await db.update(userPushTokensTable)
        .set({ token: expoPushToken, updatedAt: now as any, lastSeenAt: now as any } as any)
        .where(eq(userPushTokensTable.id, existing[0].id));
    } else {
      await db.insert(userPushTokensTable).values({
        userId: userId as any,
        token: expoPushToken,
        platform: platform ?? "unknown",
        createdAt: now as any,
        updatedAt: now as any,
        lastSeenAt: now as any,
      } as any);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Push register error:", err);
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

app.post("/api/push/notify", async (req: Request, res: Response) => {
  try {
    const { token, title, body } = req.body;
    if (!token || !title || !body) {
      res.status(400).json({ success: false, error: "Missing fields" });
      return;
    }

    console.log("🚀 [FCM] Attempting to send notification to:", token);

    // فحص أمان إضافي للتأكد من تحميل المكتبة بشكل صحيح
    if (typeof admin.messaging !== "function") {
      throw new Error("Firebase Admin SDK messaging is not available. Check installation.");
    }

    const message = {
      notification: { title, body },
      token: token,
    };

    const response = await admin.messaging().send(message);

    console.log("✅ [FCM] Success! Message ID:", response);
    res.json({ success: true, messageId: response });

  } catch (error: any) {
    console.error("❌ [FCM] Error sending notification:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message || "FCM send failed" 
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════

app.use("/api", router);

app.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Auryx API is running 🚀', endpoints: '/api/v1/*' });
});

const corsErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof Error && error.message === "origin_not_allowed") {
    res.status(403).json({ error: "origin_not_allowed" });
    return;
  }
  next(error);
};

app.use(corsErrorHandler);

export default app;
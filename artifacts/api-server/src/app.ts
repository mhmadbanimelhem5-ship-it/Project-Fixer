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

const app: Express = express();

app.set("trust proxy", 1);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(clerkMiddleware());
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
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

app.use(
  "/api/subscriptions/webhook",
  express.raw({ type: "application/json", limit: "1mb", inflate: false }),
);

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
    const userId = authReq.auth?.userId;

    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const existing = await db.select().from(userPushTokensTable)
      .where(and(eq(userPushTokensTable.userId, userId), eq(userPushTokensTable.platform, platform ?? "unknown")))
      .limit(1);

    const now = Date.now();
    if (existing.length > 0) {
      await db.update(userPushTokensTable)
        .set({ 
          token: expoPushToken, 
          updatedAt: now, 
          lastSeenAt: now 
        })
        .where(eq(userPushTokensTable.id, existing[0].id));
    } else {
      await db.insert(userPushTokensTable).values({
        userId,
        token: expoPushToken,
        platform: platform ?? "unknown",
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
      });
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
    const response = await fetch("https://api.expo.io/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: token, title, body, sound: null }),
    });
    const result = await response.json() as { data?: Array<{ status: string }> };
    if (result.data?.[0]?.status === "ok") {
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false, error: "Expo API failed", details: result });
    }
  } catch (err) {
    console.error("Push notify error:", err);
    res.status(500).json({ success: false, error: "Internal error" });
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
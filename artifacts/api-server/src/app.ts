import express, { type ErrorRequestHandler, type Express, type Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import cronRouter from "./routes/cron"; 
import { logger } from "./lib/logger";
import { generalLimiter } from "./middleware/rateLimit";
import { clerkMiddleware } from "@clerk/express";
import { clerkProxyMiddleware, CLERK_PROXY_PATH } from "./middleware/clerkProxyMiddleware";
import admin from "firebase-admin"; // ✅ تغيير الاستيراد

// ✅ 1. تهيئة Firebase Admin
if (!(admin as any).apps || (admin as any).apps.length === 0) {
  try {
    const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountStr && serviceAccountStr !== "{}") {
      const serviceAccount = JSON.parse(serviceAccountStr);
      (admin as any).initializeApp({
        credential: (admin as any).credential.cert(serviceAccount)
      });
      console.log("✅ Firebase Admin initialized successfully");
    }
  } catch (error) {
    console.error("❌ Failed to initialize Firebase Admin:", error);
  }
}

const app: Express = express();
app.set("trust proxy", 1);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// ✅ 2. الحل الجذري: استثناء مسارات الإشعارات من Clerk
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/api/push/notify' || req.path === '/api/push/register') {
    return next();
  }
  const middleware = clerkMiddleware();
  return middleware(req, res, next);
});

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
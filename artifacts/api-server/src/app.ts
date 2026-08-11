import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { generalLimiter } from "./middleware/rateLimit";
import { clerkMiddleware } from "@clerk/express";
import { clerkProxyMiddleware, CLERK_PROXY_PATH } from "./middleware/clerkProxyMiddleware";

const app: Express = express();

// The API runs behind Replit's single reverse-proxy hop. Trust it so
// express-rate-limit can safely identify the original client IP from
// X-Forwarded-For instead of treating the proxy as the client.
app.set("trust proxy", 1);

// Clerk's Frontend API proxy must run before body parsing.
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
  [process.env.WEB_APP_ORIGIN, process.env.REPLIT_DEV_DOMAIN, process.env.REPLIT_DOMAINS]
    .flatMap((value) => (value ? value.split(",") : []))
    .map((value) => (value.startsWith("http") ? value : `https://${value}`))
    .map((value) => value.replace(/\/+$/, "")),
);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) {
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply the general API limit before any route handler runs.
app.use("/api/", generalLimiter);
app.use("/api", router);
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Auryx API is running 🚀', endpoints: '/api/v1/*' });
});
export default app;

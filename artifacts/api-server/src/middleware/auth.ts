import type { NextFunction, Request, RequestHandler, Response } from "express";
import { clerkClient, getAuth, verifyToken } from "@clerk/express";
import { canAccessPublicKey, lookupSealedVault } from "../lib/keyStore";
import { logger } from "../lib/logger";

export interface AuthenticatedRequest extends Request {
  authUser?: {
    id: string;
    email: string;
  };
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function decodeJwtClaims(token: string | null): Record<string, unknown> | null {
  try {
    if (!token) return null;
    const part = token.split(".")[1];
    if (!part) return null;
    const json = Buffer.from(part, "base64url").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/* ─── تشخيص موحد وعميق لرفض المصادقة ─────────────────────────────────────── */

function maskToken(raw: string | null): string {
  if (!raw) return "(none)";
  if (raw.length <= 12) return `(${raw.length} chars)`;
  return `${raw.slice(0, 8)}…${raw.slice(-4)}`;
}

type TokenState = "expired" | "not_yet_valid" | "time_ok" | "malformed" | "missing";

function getTokenState(claims: Record<string, unknown> | null, nowEpoch: number): TokenState {
  if (!claims) return "missing";
  const exp = typeof claims.exp === "number" ? claims.exp : null;
  const iat = typeof claims.iat === "number" ? claims.iat : null;
  if (exp === null && iat === null) return "malformed";
  if (exp !== null && exp < nowEpoch) return "expired";
  if (iat !== null && iat > nowEpoch + 30) return "not_yet_valid";
  return "time_ok";
}

type RejectionContext = {
  layer:
    | "clerkMiddleware"
    | "requireAuth"
    | "requireClerkUserId"
    | "requireOwner"
    | "requireParticipant"
    | "requireVaultParticipant"
    | "requirePublicKeyAccess"
    | "rateLimiter"
    | "unknown";
  req: Request;
  reason: string;
  extra?: Record<string, unknown>;
};

function logRejection(ctx: RejectionContext): void {
  const authorization = ctx.req.get("authorization") ?? null;
  const rawToken = authorization?.replace(/^Bearer\s+/i, "") ?? null;
  const hasBearerToken = /^Bearer\s+\S+$/i.test(authorization ?? "");
  const claims = decodeJwtClaims(rawToken);
  const clerkAuth = getAuth(ctx.req);
  const nowEpoch = Math.floor(Date.now() / 1000);
  const tokenState = getTokenState(claims, nowEpoch);

  logger.warn(
    {
      event: "auth_rejected_deep",
      rejecting_layer: ctx.layer,
      method: ctx.req.method,
      path: ctx.req.originalUrl,
      user_agent: ctx.req.get("user-agent")?.slice(0, 80) ?? null,
      ip: ctx.req.ip ?? null,
      hasAuthorization: Boolean(authorization),
      hasBearerToken,
      authorizationScheme: authorization?.split(" ", 1)[0] ?? null,
      authorization_preview: maskToken(rawToken),
      token_state: tokenState,
      token_sub: typeof claims?.sub === "string" ? String(claims.sub).slice(0, 10) + "…" : null,
      token_iss: typeof claims?.iss === "string" ? claims.iss : null,
      token_iat: typeof claims?.iat === "number" ? claims.iat : null,
      token_exp: typeof claims?.exp === "number" ? claims.exp : null,
      now_epoch: nowEpoch,
      clerk_userId_present: Boolean(clerkAuth.userId),
      clerk_sessionId_present: Boolean((clerkAuth as any).sessionId),
      root_cause_401: ctx.reason,
      ...(ctx.extra ?? {}),
    },
    `[auth][${ctx.layer}] rejected: ${ctx.reason}`,
  );
}

/* ─── المصادقة الأساسية ───────────────────────────────────────────────────── */

export async function getAuthenticatedUser(req: Request): Promise<{ id: string; email: string } | null> {
  const { userId } = getAuth(req);
  if (!userId) return null;
  try {
    const user = await clerkClient.users.getUser(userId);
    const email = user.primaryEmailAddress?.emailAddress;
    if (!email) {
      logger.warn({ userId, msg: "auth_no_primary_email" });
      return null;
    }
    return { id: user.id, email: normalizeEmail(email) };
  } catch (err) {
    logger.warn({
      userId,
      err: err instanceof Error ? err.message : String(err),
      msg: "auth_clerk_getUser_failed",
    });
    return null;
  }
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      const authorization = req.get("authorization");
      const hasBearerToken = /^Bearer\s+\S+$/i.test(authorization ?? "");
      const clerkAuth = getAuth(req);
      const reasonFor401 = !authorization
        ? "missing_authorization_header"
        : !hasBearerToken
          ? "invalid_authorization_scheme"
          : !clerkAuth.userId
            ? "clerk_user_missing"
            : "clerk_user_lookup_failed_or_primary_email_missing";

      logRejection({
        layer: "requireAuth",
        req,
        reason: reasonFor401,
        extra: { msg: `auth_rejected:${reasonFor401}` },
      });

      res.status(401).json({ error: "unauthorized", reason: reasonFor401 });
      return;
    }
    (req as AuthenticatedRequest).authUser = user;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Session userId only (no users.getUser / email). Used by push/register.
 */
export const requireClerkUserId: RequestHandler = async (req, res, next) => {
  try {
    let userId: string | null = getAuth(req).userId ?? null;
    let verifyTokenError: string | null = null;

    if (!userId) {
      const authorization = req.get("authorization");
      const raw =
        authorization && /^Bearer\s+\S+$/i.test(authorization)
          ? authorization.replace(/^Bearer\s+/i, "").trim()
          : null;
      if (raw) {
        try {
          const payload = await verifyToken(raw, {
            secretKey: process.env.CLERK_SECRET_KEY,
          });
          if (payload && typeof payload.sub === "string" && payload.sub.length > 0) {
            userId = payload.sub;
          } else {
            verifyTokenError = "payload_missing_sub";
          }
        } catch (err) {
          verifyTokenError = err instanceof Error ? err.message : String(err);
        }
      }
    }

    if (!userId) {
      const authorization = req.get("authorization");
      const hasBearerToken = /^Bearer\s+\S+$/i.test(authorization ?? "");
      const reasonFor401 = !authorization
        ? "missing_authorization_header"
        : !hasBearerToken
          ? "invalid_authorization_scheme"
          : verifyTokenError
            ? `verify_token_failed:${verifyTokenError.slice(0, 60)}`
            : "clerk_user_missing";

      logRejection({
        layer: "requireClerkUserId",
        req,
        reason: reasonFor401,
        extra: {
          clerk_secret_key_configured: Boolean(process.env.CLERK_SECRET_KEY),
          verify_token_error: verifyTokenError?.slice(0, 120) ?? null,
          msg: `auth_rejected:${reasonFor401}`,
        },
      });

      res.status(401).json({ error: "unauthorized", reason: reasonFor401 });
      return;
    }

    (req as AuthenticatedRequest).authUser = { id: userId, email: "" };
    next();
  } catch (error) {
    next(error);
  }
};

/* ─── بقية middlewares (بدون تغيير سلوك، فقط تشخيص عند الفشل) ────────────── */

export function requireOwner(field = "ownerEmail"): RequestHandler {
  return async (req, res: Response, next: NextFunction) => {
    try {
      const user = (req as AuthenticatedRequest).authUser ?? (await getAuthenticatedUser(req));
      const requested = req.params[field] ?? req.body?.[field] ?? req.query?.[field];
      if (!user) {
        logRejection({ layer: "requireOwner", req, reason: "no_auth_user" });
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      if (typeof requested !== "string" || normalizeEmail(requested) !== user.email) {
        res.status(403).json({ error: "owner_authorization_required" });
        return;
      }
      (req as AuthenticatedRequest).authUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireParticipant(fields: string[]): RequestHandler {
  return async (req, res: Response, next: NextFunction) => {
    try {
      const user = (req as AuthenticatedRequest).authUser ?? (await getAuthenticatedUser(req));
      if (!user) {
        logRejection({ layer: "requireParticipant", req, reason: "no_auth_user" });
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const matches = fields.some((field) => {
        const requested = req.params[field] ?? req.body?.[field] ?? req.query?.[field];
        return typeof requested === "string" && normalizeEmail(requested) === user.email;
      });
      if (!matches) {
        res.status(403).json({ error: "participant_authorization_required" });
        return;
      }
      (req as AuthenticatedRequest).authUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireVaultParticipant(field = "ownerEmail"): RequestHandler {
  return async (req, res: Response, next: NextFunction) => {
    try {
      const user = (req as AuthenticatedRequest).authUser ?? (await getAuthenticatedUser(req));
      const ownerEmail = req.params[field] ?? req.body?.[field] ?? req.query?.[field];
      if (!user) {
        logRejection({ layer: "requireVaultParticipant", req, reason: "no_auth_user" });
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      if (typeof ownerEmail !== "string") {
        res.status(400).json({ error: "owner_email_required" });
        return;
      }
      const vault = await lookupSealedVault(ownerEmail);
      const participantEmails = vault
        ? [ownerEmail, vault.beneficiaryEmail, ...vault.guardianPackages.map((item) => item.email)]
        : [];
      if (!participantEmails.some((email) => normalizeEmail(email) === user.email)) {
        res.status(403).json({ error: "vault_participant_authorization_required" });
        return;
      }
      (req as AuthenticatedRequest).authUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requirePublicKeyAccess(field = "email"): RequestHandler {
  return async (req, res: Response, next: NextFunction) => {
    try {
      const user = (req as AuthenticatedRequest).authUser ?? (await getAuthenticatedUser(req));
      const requested = req.params[field] ?? req.body?.[field] ?? req.query?.[field];
      if (!user) {
        logRejection({ layer: "requirePublicKeyAccess", req, reason: "no_auth_user" });
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      if (typeof requested !== "string") {
        res.status(400).json({ error: "email_required" });
        return;
      }
      if (!(await canAccessPublicKey(user.email, requested))) {
        res.status(403).json({ error: "public_key_access_forbidden" });
        return;
      }
      (req as AuthenticatedRequest).authUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function authUserEmail(req: Request): string | null {
  return (req as AuthenticatedRequest).authUser?.email ?? null;
}
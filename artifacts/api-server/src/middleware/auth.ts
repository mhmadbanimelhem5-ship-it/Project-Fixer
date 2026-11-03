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
      const rawToken = authorization?.replace(/^Bearer\s+/i, "") ?? null;
      const claims = decodeJwtClaims(rawToken);
      logger.warn({
        event: "auth_rejected",
        method: req.method,
        path: req.originalUrl,
        hasAuthorization: Boolean(authorization),
        hasBearerToken,
        authorizationScheme: authorization?.split(" ", 1)[0] ?? null,
        clerkUserIdPresent: Boolean(clerkAuth.userId),
        reasonFor401,
        tokenIss: typeof claims?.iss === "string" ? claims.iss : null,
        tokenExp: typeof claims?.exp === "number" ? claims.exp : null,
        nowEpoch: Math.floor(Date.now() / 1000),
        msg: `auth_rejected:${reasonFor401}`,
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
 * 1) Prefer getAuth after clerkMiddleware
 * 2) Else verify Bearer via verifyToken from @clerk/backend (re-exported by @clerk/express@2.1.47)
 */
export const requireClerkUserId: RequestHandler = async (req, res, next) => {
  try {
    let userId: string | null = getAuth(req).userId ?? null;

    if (!userId) {
      const authorization = req.get("authorization");
      const raw =
        authorization && /^Bearer\s+\S+$/i.test(authorization)
          ? authorization.replace(/^Bearer\s+/i, "").trim()
          : null;
      if (raw) {
        try {
          // Documented API: verifyToken(token, { secretKey }) — NOT clerkClient.verifyToken
          const payload = await verifyToken(raw, {
            secretKey: process.env.CLERK_SECRET_KEY,
          });
          if (payload && typeof payload.sub === "string" && payload.sub.length > 0) {
            userId = payload.sub;
          }
        } catch (err) {
          logger.info({
            event: "auth_verify_token_failed",
            path: req.originalUrl,
            err: err instanceof Error ? err.message : String(err),
            msg: "auth_verify_token_failed",
          });
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
          : "clerk_user_missing";
      const claims = decodeJwtClaims(authorization?.replace(/^Bearer\s+/i, "") ?? null);
      logger.info({
        event: "auth_rejected",
        method: req.method,
        path: req.originalUrl,
        hasAuthorization: Boolean(authorization),
        hasBearerToken,
        reasonFor401,
        tokenIss: typeof claims?.iss === "string" ? claims.iss : null,
        tokenExp: typeof claims?.exp === "number" ? claims.exp : null,
        nowEpoch: Math.floor(Date.now() / 1000),
        msg: `auth_rejected:${reasonFor401}`,
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

export function requireOwner(field = "ownerEmail"): RequestHandler {
  return async (req, res: Response, next: NextFunction) => {
    try {
      const user = (req as AuthenticatedRequest).authUser ?? (await getAuthenticatedUser(req));
      const requested = req.params[field] ?? req.body?.[field] ?? req.query?.[field];
      if (!user) {
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
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      if (typeof requested !== "string") {
        res.status(400).json({ error: "email_required" });
        return;
      }
      if (!await canAccessPublicKey(user.email, requested)) {
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
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { canAccessPublicKey, lookupSealedVault } from "../lib/keyStore";

export interface AuthenticatedRequest extends Request {
  authUser?: {
    id: string;
    email: string;
  };
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export async function getAuthenticatedUser(req: Request): Promise<{ id: string; email: string } | null> {
  const { userId } = getAuth(req);
  if (!userId) return null;
  const user = await clerkClient.users.getUser(userId);
  const email = user.primaryEmailAddress?.emailAddress;
  if (!email) return null;
  return { id: user.id, email: normalizeEmail(email) };
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    (req as AuthenticatedRequest).authUser = user;
    next();
  } catch (error) {
    next(error);
  }
};

export function requireOwner(field = "ownerEmail"): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
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
  return async (req: Request, res: Response, next: NextFunction) => {
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
  return async (req: Request, res: Response, next: NextFunction) => {
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
  return async (req: Request, res: Response, next: NextFunction) => {
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
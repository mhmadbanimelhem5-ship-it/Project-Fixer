import type { RequestHandler } from "express";
import type { ZodTypeAny } from "zod";

export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "validation_failed",
        issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateParams(schema: ZodTypeAny): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      res.status(400).json({ error: "validation_failed", issues: result.error.issues });
      return;
    }
    req.params = result.data as typeof req.params;
    next();
  };
}
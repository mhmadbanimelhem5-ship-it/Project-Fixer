import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch (error) {
    const value = error as { code?: unknown; name?: unknown };
    logger.error(
      {
        errorCode: typeof value.code === "string" ? value.code : undefined,
        errorName: typeof value.name === "string" ? value.name : undefined,
      },
      "Health check database failed",
    );
    res.status(503).json({ status: "error", service: "database" });
  }
});

export default router;

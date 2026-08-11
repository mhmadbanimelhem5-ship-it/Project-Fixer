import app from "./app";
import { logger } from "./lib/logger";

// صدر الـ app عشان Vercel يقدر يستخدمه
export { app };
export default app;

// اذا احنا على Vercel لا تشغل listen ابدا!
if (process.env.VERCEL) {
  logger.info("Running on Vercel - skipping listen");
} else {
  const rawPort = process.env["PORT"] || "3001";
  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}
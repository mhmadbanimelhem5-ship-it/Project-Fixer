import { Router, type IRouter } from "express";
import healthRouter from "./health";
import emailRouter from "./email";
import inviteRouter from "./invite";
import pushRouter from "./push";
import keysRouter from "./keys";
import vaultTransferRouter from "./vaultTransfer";
import absenceRouter from "./absence";
import pinResetRouter from "./pin-reset";
import recoveryEmailRouter from "./recovery-email";
import waitlistRouter from "./waitlist";
import subscriptionsRouter from "./subscriptions";
import { logger } from "../lib/logger"; // ← إضافة لتسجيل التشخيص

const router: IRouter = Router();

router.use(healthRouter);
router.use('/email', emailRouter);
router.use('/invite', inviteRouter);
router.use('/push', pushRouter);
router.use('/keys', keysRouter);
router.use('/vault', vaultTransferRouter);
router.use('/absence', absenceRouter);
router.use('/pin-reset', pinResetRouter);
router.use('/recovery-email', recoveryEmailRouter);
router.use('/waitlist', waitlistRouter);
router.use('/subscriptions', subscriptionsRouter);

// ── DIAGNOSTIC LOGGING ───────────────────────────────────────────────────────
// هذا السطر سيظهر في سجلات Vercel عند بدء تشغيل الخادم، مما يثبت 100% أن المسار تم تسجيله
logger.info("[DIAGNOSTIC] API Routes registered successfully.");
logger.info("[DIAGNOSTIC] Recovery Email route is ACTIVE at: /api/recovery-email");
// ──────────────────────────────────────────────────────────────────────────────

export default router;
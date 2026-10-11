import { Router, type IRouter } from "express";
import healthRouter from "./health";
import emailRouter from "./email";
import inviteRouter from "./invite";
import pushRouter from "./push";
import keysRouter from "./keys";
import vaultTransferRouter from "./vaultTransfer";
import absenceRouter from "./absence";
import pinResetRouter from "./pin-reset";
import recoveryEmailRouter from "./recovery-email"; // ← إضافة جديدة
import waitlistRouter from "./waitlist";
import subscriptionsRouter from "./subscriptions";

const router: IRouter = Router();

router.use(healthRouter);
router.use('/email', emailRouter);
router.use('/invite', inviteRouter);
router.use('/push', pushRouter);
router.use('/keys', keysRouter);
router.use('/vault', vaultTransferRouter);
router.use('/absence', absenceRouter);
router.use('/pin-reset', pinResetRouter);
router.use('/recovery-email', recoveryEmailRouter); // ← إضافة جديدة
router.use('/waitlist', waitlistRouter);
router.use('/subscriptions', subscriptionsRouter);

export default router;
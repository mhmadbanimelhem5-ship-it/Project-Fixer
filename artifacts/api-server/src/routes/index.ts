import { Router, type IRouter } from "express";
import healthRouter from "./health";
import emailRouter from "./email";
import inviteRouter from "./invite";
import pushRouter from "./push";
import keysRouter from "./keys";
import vaultTransferRouter from "./vaultTransfer";
import absenceRouter from "./absence";
import waitlistRouter from "./waitlist";

const router: IRouter = Router();

router.use(healthRouter);
router.use('/email', emailRouter);
router.use('/invite', inviteRouter);
router.use('/push', pushRouter);
router.use('/keys', keysRouter);
router.use('/vault', vaultTransferRouter);
router.use('/absence', absenceRouter);
router.use('/waitlist', waitlistRouter);

export default router;

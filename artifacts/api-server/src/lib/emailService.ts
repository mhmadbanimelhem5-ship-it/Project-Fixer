import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import crypto from 'crypto';
import { logger } from './logger';
import { db, inviteTokensTable, retryQueueTable } from '@workspace/db';
import { eq, and, gt, lte } from 'drizzle-orm';

// ─── Token Store ──────────────────────────────────────────────────────────────
export type TokenType = 'guardian-invite' | 'beneficiary-invite';
export type TokenStatus = 'pending' | 'accepted' | 'rejected';

export interface InviteToken {
  token: string;
  type: TokenType;
  recipientEmail: string;
  ownerName: string;
  createdAt: number;
  expiresAt: number;
  status: TokenStatus;
  meta: Record<string, string>;
}

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createToken(
  type: TokenType,
  recipientEmail: string,
  ownerName: string,
  meta: Record<string, string> = {},
): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  await db.insert(inviteTokensTable).values({
    token,
    type,
    email: recipientEmail.toLowerCase(),
    ownerName,
    data: meta,
    status: 'pending',
    createdAt: now,
    expiresAt: now + TOKEN_TTL_MS,
  });
  logger.info({ token, type, email: recipientEmail }, 'Invite token stored in DB');
  return token;
}

export async function getToken(token: string): Promise<InviteToken | undefined> {
  const rows = await db
    .select()
    .from(inviteTokensTable)
    .where(eq(inviteTokensTable.token, token))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;

  if (Date.now() > row.expiresAt) {
    await db.delete(inviteTokensTable).where(eq(inviteTokensTable.token, token));
    logger.info({ token }, 'Invite token expired and removed');
    return undefined;
  }

  return {
    token: row.token,
    type: row.type as TokenType,
    recipientEmail: row.email,
    ownerName: row.ownerName,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    status: row.status as TokenStatus,
    meta: (row.data as Record<string, string>) ?? {},
  };
}

export async function updateTokenStatus(token: string, status: TokenStatus): Promise<boolean> {
  const now = Date.now();
  const updated = await db
    .update(inviteTokensTable)
    .set({ status })
    .where(
      and(
        eq(inviteTokensTable.token, token),
        eq(inviteTokensTable.status, 'pending'),
        gt(inviteTokensTable.expiresAt, now),
      ),
    )
    .returning();

  const success = updated.length > 0;
  logger.info({ token, status, success }, 'Invite token status updated');
  return success;
}

// ─── Provider detection ───────────────────────────────────────────────────────
// Priority: Resend (if RESEND_API_KEY set) → SMTP Gmail (if SMTP_USER + SMTP_PASS set)
function getActiveProvider(): 'resend' | 'smtp' | 'none' {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  return 'none';
}

// ─── Resend transport ─────────────────────────────────────────────────────────
let resendClient: Resend | null = null;
let cachedResendKey: string | undefined;

function getResendClient(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!resendClient || key !== cachedResendKey) {
    resendClient = new Resend(key);
    cachedResendKey = key;
  }
  return resendClient;
}

// ─── SMTP transport ───────────────────────────────────────────────────────────
let transporter: nodemailer.Transporter | null = null;
let cachedSmtpUser: string | undefined;
let cachedSmtpPass: string | undefined;

function getTransporter(): nodemailer.Transporter {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    throw new Error('SMTP credentials not configured');
  }
  if (!transporter || user !== cachedSmtpUser || pass !== cachedSmtpPass) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user, pass },
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 10_000,
      greetingTimeout: 8_000,
      socketTimeout: 15_000,
    });
    cachedSmtpUser = user;
    cachedSmtpPass = pass;
  }
  return transporter;
}

// ─── Health check (used by /api/email/healthz) ────────────────────────────────
export async function checkEmailHealth(): Promise<{
  provider: 'resend' | 'smtp' | 'none';
  configured: boolean;
  smtpVerified?: boolean;
  smtpError?: string;
}> {
  const provider = getActiveProvider();

  if (provider === 'resend') {
    return { provider, configured: true };
  }

  if (provider === 'smtp') {
    try {
      await getTransporter().verify();
      return { provider, configured: true, smtpVerified: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { provider, configured: true, smtpVerified: false, smtpError: msg };
    }
  }

  return { provider: 'none', configured: false };
}

function getBaseUrl(): string {
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) return `https://${domains.split(',')[0].trim()}`;
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) return `https://${devDomain}`;
  return 'http://localhost:80';
}

async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const provider = getActiveProvider();

  if (provider === 'none') {
    logger.warn({ to, subject }, 'Email provider not configured — set RESEND_API_KEY or SMTP_USER + SMTP_PASS');
    throw new Error('خدمة البريد الإلكتروني غير مهيأة على الخادم. تواصل مع مدير التطبيق.');
  }

  if (provider === 'resend') {
    try {
      const smtpUser = process.env.SMTP_USER ?? 'noreply@auryx.app';
      const result = await getResendClient().emails.send({
        from: `Auryx Vault <${smtpUser}>`,
        to,
        subject,
        html,
      });
      if (result.error) {
        logger.error({ to, subject, error: result.error }, 'Resend error');
        throw new Error(`فشل إرسال البريد عبر Resend: ${result.error.message}`);
      }
      logger.info({ to, subject, provider: 'resend' }, 'Email sent via Resend');
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ to, subject, err: msg }, 'Resend send failed');
      throw new Error(`فشل إرسال البريد عبر Resend: ${msg}`);
    }
  }

  // SMTP path
  const smtpUser = process.env.SMTP_USER!;
  try {
    await getTransporter().sendMail({
      from: `"Auryx Vault" <${smtpUser}>`,
      to,
      subject,
      html,
    });
    logger.info({ to, subject, provider: 'smtp' }, 'Email sent via SMTP');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ to, subject, smtpUser, err: msg }, 'SMTP send failed');
    throw new Error(`فشل إرسال البريد عبر SMTP: ${msg}`);
  }
}

// ─── HTML Template ────────────────────────────────────────────────────────────
function wrap(body: string): string {
  return `<!DOCTYPE html><html dir="rtl" lang="ar">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{box-sizing:border-box}
  body{background:#0A0F1E;color:#E2E8F0;font-family:Arial,Helvetica,sans-serif;margin:0;padding:20px}
  .card{background:rgba(255,255,255,0.05);border:1px solid rgba(212,175,55,0.25);border-radius:20px;max-width:560px;margin:40px auto;padding:36px;text-align:center}
  .logo{font-size:26px;font-weight:700;color:#D4AF37;letter-spacing:3px;margin-bottom:6px}
  .tagline{font-size:12px;color:#64748B;margin-bottom:32px}
  p{font-size:15px;line-height:1.8;color:#CBD5E1;margin:0 0 14px}
  strong{color:#D4AF37}
  .btn{display:inline-block;margin:6px 8px;padding:13px 30px;border-radius:12px;font-size:14px;font-weight:700;text-decoration:none;color:#0A0F1E;background:linear-gradient(135deg,#D4AF37,#B8960C)}
  .btn-red{background:linear-gradient(135deg,#EF4444,#DC2626);color:#fff}
  .divider{border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0}
  .hint{font-size:12px;color:#475569;line-height:1.6;margin:0}
  .footer{margin-top:28px;font-size:11px;color:#334155}
</style></head>
<body><div class="card">
<div class="logo">⬡ Auryx</div>
<div class="tagline">عالمك. محمي للأبد.</div>
${body}
<div class="footer">هذا بريد تلقائي من نظام Auryx — لا ترد على هذا البريد مباشرةً.</div>
</div></body></html>`;
}

// ─── Email Senders ────────────────────────────────────────────────────────────

export async function sendGuardianInvite(
  ownerName: string,
  guardianEmail: string,
  token: string,
): Promise<void> {
  const base = getBaseUrl();
  const acceptUrl = `${base}/api/invite/accept/${token}`;
  const rejectUrl = `${base}/api/invite/reject/${token}`;
  const html = wrap(`
    <p>تم تعيينك كوصي على بيانات الخزنة الخاصة بـ <strong>${ownerName}</strong></p>
    <p>هل توافق على أن تكون وصيًا؟</p>
    <a href="${acceptUrl}" class="btn">✅ &nbsp;نعم، أوافق</a>
    <a href="${rejectUrl}" class="btn btn-red">❌ &nbsp;لا، أرفض</a>
    <hr class="divider">
    <p class="hint">يمكنك أيضاً الموافقة من داخل تطبيق Auryx بعد تثبيته.</p>
    <p class="hint" style="margin-top:6px">هذا الرابط صالح لمدة 7 أيام فقط. لا تشاركه مع أحد.</p>
  `);
  await sendMail(guardianEmail, `طلب وصاية من ${ownerName} — Auryx`, html);
}

export async function sendGuardianRemoved(
  ownerName: string,
  guardianEmail: string,
): Promise<void> {
  const html = wrap(`
    <p>تم إلغاء وصايتك على بيانات الخزنة الخاصة بـ <strong>${ownerName}</strong></p>
    <p style="color:#94A3B8">لم تعد وصيًا على هذه البيانات.</p>
  `);
  await sendMail(guardianEmail, `إلغاء الوصاية — Auryx`, html);
}

export async function sendBeneficiaryInvite(
  ownerName: string,
  beneficiaryEmail: string,
  relationship: string,
  token: string,
): Promise<void> {
  const base = getBaseUrl();
  const acceptUrl = `${base}/api/invite/accept/${token}`;
  const rejectUrl = `${base}/api/invite/reject/${token}`;
  const relStr = relationship ? `<p style="color:#94A3B8">علاقتك بصاحب الخزنة: ${relationship}</p>` : '';
  const html = wrap(`
    <p>طلب منك <strong>${ownerName}</strong> أن تكون المستفيد النهائي المخول بفتح خزنته في حالة الطوارئ أو الغياب</p>
    ${relStr}
    <p>هل توافق؟</p>
    <a href="${acceptUrl}" class="btn">✅ &nbsp;نعم، أوافق</a>
    <a href="${rejectUrl}" class="btn btn-red">❌ &nbsp;لا، أرفض</a>
    <hr class="divider">
    <p class="hint">يمكنك أيضاً الموافقة من داخل تطبيق Auryx بعد تثبيته.</p>
    <p class="hint" style="margin-top:6px">هذا الرابط صالح لمدة 7 أيام فقط.</p>
  `);
  await sendMail(beneficiaryEmail, `طلب مستفيد نهائي من ${ownerName} — Auryx`, html);
}

export async function sendBeneficiaryRemoved(
  ownerName: string,
  beneficiaryEmail: string,
): Promise<void> {
  const html = wrap(`
    <p>تم إلغاء دورك كمستفيد نهائي على بيانات الخزنة الخاصة بـ <strong>${ownerName}</strong></p>
    <p style="color:#94A3B8">لم تعد مخولًا بفتح الخزنة في حالات الطوارئ.</p>
  `);
  await sendMail(beneficiaryEmail, `إلغاء دور المستفيد النهائي — Auryx`, html);
}

export async function sendEmergencyActivation(
  ownerName: string,
  beneficiaryName: string,
  beneficiaryRelation: string,
  guardianEmails: string[],
): Promise<void> {
  const relStr = beneficiaryRelation ? ` (${beneficiaryRelation})` : '';
  const html = wrap(`
    <p>⚠️ تم تفعيل بروتوكول الطوارئ لخزنة <strong>${ownerName}</strong></p>
    <p>بواسطة المستفيد النهائي: <strong style="color:#EF4444">${beneficiaryName}${relStr}</strong></p>
    <p>مدة الانتظار للتأكد من غياب صاحب الخزنة هي <strong>48 ساعة</strong></p>
    <p style="color:#94A3B8">بعد انتهاء المدة سيتم بدء عملية التصويت لفتح الخزنة لدى المستفيد النهائي.</p>
    <hr class="divider">
    <p class="hint">إذا كان هذا البروتوكول قد فُعِّل بالخطأ، يرجى فتح تطبيق Auryx فوراً لإلغائه.</p>
  `);
  await Promise.allSettled(
    guardianEmails.map(email => sendMail(email, `🚨 بروتوكول الطوارئ — ${ownerName}`, html)),
  );
}

export async function sendVoteRequest(
  ownerName: string,
  guardianEmails: string[],
): Promise<void> {
  const html = wrap(`
    <p>تم التأكد من غياب <strong>${ownerName}</strong></p>
    <p>يرجى التصويت على فتح الخزنة.</p>
    <p style="color:#94A3B8">بعد موافقة الأوصياء سيتم فتح الخزنة على جهاز المستفيد النهائي.</p>
    <hr class="divider">
    <p class="hint">افتح تطبيق Auryx للمشاركة في التصويت.</p>
  `);
  await Promise.allSettled(
    guardianEmails.map(email => sendMail(email, `🗳️ طلب التصويت لفتح الخزنة — ${ownerName}`, html)),
  );
}

export async function sendVaultAccessOtp(
  beneficiaryEmail: string,
  ownerName: string,
  otp: string,
): Promise<void> {
  const html = wrap(`
    <p>📬 تم نقل خزنة <strong>${ownerName}</strong> الرقمية إليك</p>
    <p>استخدم الرمز السري التالي لفتح الخزنة داخل تطبيق Auryx:</p>
    <div style="text-align:center;margin:28px 0">
      <div style="display:inline-block;background:linear-gradient(135deg,rgba(212,175,55,0.15),rgba(139,92,246,0.15));border:2px solid rgba(212,175,55,0.4);border-radius:16px;padding:20px 36px">
        <span style="font-size:42px;font-weight:700;letter-spacing:16px;color:#D4AF37;font-family:monospace">${otp}</span>
      </div>
    </div>
    <p style="text-align:center;color:#94A3B8;font-size:13px">⏳ هذا الرمز صالح لمدة <strong style="color:#F59E0B">48 ساعة</strong> فقط</p>
    <hr class="divider">
    <p class="hint">افتح تطبيق Auryx ← اضغط "الطوارئ" ← اضغط "استلام خزنة"، ثم أدخل بريد ${ownerName} وهذا الرمز.</p>
    <p class="hint">إذا انتهت صلاحية الرمز، اطلب من صاحب الخزنة إرسال رمز جديد.</p>
  `);
  await sendMail(beneficiaryEmail, `🔑 رمز استلام الخزنة — ${ownerName}`, html);
}

export async function sendOwnerNotification(
  ownerEmail: string,
  ownerName: string,
  beneficiaryName: string,
  notifCount: number,
  aliveUrl = '',
): Promise<void> {
  const remaining = 16 - notifCount;
  const aliveBtn = aliveUrl
    ? `<a href="${aliveUrl}" class="btn" style="margin-top:16px">✅ &nbsp;أنا بخير — إلغاء البروتوكول</a>`
    : '<p class="hint" style="margin-top:12px">افتح تطبيق Auryx لإلغاء البروتوكول.</p>';

  const html = wrap(`
    <p>⏰ تنبيه: <strong>${beneficiaryName}</strong> يطلب الوصول إلى خزنتك</p>
    <p>إذا كنت بخير، اضغط الزر أدناه لإلغاء بروتوكول الطوارئ فوراً:</p>
    ${aliveBtn}
    <p style="color:#EF4444;margin-top:18px"><strong>تبقّى ${remaining} إشعاراً</strong> قبل انتهاء مدة الانتظار (48 ساعة)</p>
    <hr class="divider">
    <p class="hint">إشعار ${notifCount} من 16 — يُرسَل كل 3 ساعات تلقائياً من نظام Auryx</p>
    <p class="hint" style="margin-top:6px">
      ⏰ وقت الإرسال: ${new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })}
    </p>
  `);
  await sendMail(ownerEmail, `⚠️ تنبيه طوارئ Auryx — ${beneficiaryName} يطلب وصولاً`, html);
  logger.info({ ownerEmail, notifCount, aliveUrlSet: !!aliveUrl }, 'Owner absence notification sent');
}

/** Notify beneficiary that the owner confirmed they are alive — protocol cancelled. */
export async function sendOwnerAliveNotification(
  beneficiaryEmail: string,
  ownerName: string,
): Promise<void> {
  const html = wrap(`
    <p>✅ أكّد <strong>${ownerName}</strong> أنه بخير وأنه موجود.</p>
    <p>تم إلغاء بروتوكول الطوارئ تلقائياً.</p>
    <p style="color:#94A3B8">لا يمكن فتح الخزنة في الوقت الحالي. إذا كنت تحتاج للوصول مستقبلاً يمكنك إعادة تفعيل البروتوكول من التطبيق.</p>
    <hr class="divider">
    <p class="hint" style="margin-top:6px">
      ⏰ وقت الإلغاء: ${new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })}
    </p>
  `);
  await sendMail(beneficiaryEmail, `✅ المالك بخير — تم إلغاء بروتوكول الطوارئ`, html);
  logger.info({ beneficiaryEmail, ownerName }, 'Owner-alive notification sent to beneficiary');
}

/** Notify beneficiary that owner has not responded for 48h — open app to proceed. */
export async function sendBeneficiaryOwnerAbsent(
  beneficiaryEmail: string,
  ownerName: string,
): Promise<void> {
  const html = wrap(`
    <p>⏰ لم يرد <strong>${ownerName}</strong> على أي من إشعارات التحقق خلال <strong>48 ساعة</strong>.</p>
    <p>يمكنك الآن المتابعة لتفعيل تصويت الأوصياء لفتح الخزنة.</p>
    <div style="text-align:center;margin:28px 0">
      <p style="color:#EF4444;font-size:15px;font-weight:700">
        ⚠️ افتح تطبيق Auryx واضغط "متابعة بروتوكول الطوارئ" لإرسال طلب التصويت للأوصياء
      </p>
    </div>
    <hr class="divider">
    <p class="hint">هذا الإشعار تلقائي من نظام Auryx — تأكّد من هويتك قبل المتابعة.</p>
    <p class="hint" style="margin-top:6px">
      ⏰ وقت الإشعار: ${new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })}
    </p>
  `);
  await sendMail(beneficiaryEmail, `⚠️ المالك لم يرد 48 ساعة — Auryx`, html);
  logger.info({ beneficiaryEmail, ownerName }, 'Owner-absent notification sent to beneficiary');
}

export async function sendGuardianVoteRequest(
  ownerName: string,
  beneficiaryName: string,
  guardianEmails: string[],
  guardianLinks: Map<string, { approveUrl: string; rejectUrl: string }>,
): Promise<void> {
  await Promise.allSettled(
    guardianEmails.map(async (email) => {
      const links = guardianLinks.get(email.toLowerCase());
      const buttons = links
        ? `<a href="${links.approveUrl}" class="btn">✅ &nbsp;أوافق على فتح الخزنة</a>
           <a href="${links.rejectUrl}" class="btn btn-red">❌ &nbsp;أرفض</a>`
        : '<p class="hint">افتح تطبيق Auryx للتصويت.</p>';

      const html = wrap(`
        <p>⚠️ تأكد من غياب <strong>${ownerName}</strong> لأكثر من 48 ساعة</p>
        <p>المستفيد <strong>${beneficiaryName}</strong> يطلب فتح الخزنة.</p>
        <p>يرجى التصويت على الطلب:</p>
        ${buttons}
        <hr class="divider">
        <p class="hint">يحتاج البروتوكول إلى موافقة الأغلبية من الأوصياء لفتح الخزنة.</p>
        <p class="hint" style="margin-top:6px">
          ⏰ وقت الإرسال: ${new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })}
        </p>
      `);
      await sendMail(email, `🗳️ طلب التصويت لفتح خزنة ${ownerName} — Auryx`, html);
      logger.info({ guardianEmail: email, ownerName }, 'Guardian vote request email sent');
    }),
  );
}

// ─── Retry Queue ───────────────────────────────────────────────────────────────

export type RetryType = 'otp-email' | 'guardian-invite' | 'beneficiary-invite' | 'vote-request' | 'owner-notification' | 'beneficiary-absent';

async function sendEmailByType(type: RetryType, email: string, data: Record<string, unknown>): Promise<void> {
  switch (type) {
    case 'otp-email': {
      const otp = String(data.otp ?? '');
      const ownerName = String(data.ownerName ?? email);
      await sendVaultAccessOtp(email, ownerName, otp);
      return;
    }
    case 'guardian-invite': {
      const ownerName = String(data.ownerName ?? '');
      const token = String(data.token ?? '');
      await sendGuardianInvite(ownerName, email, token);
      return;
    }
    case 'beneficiary-invite': {
      const ownerName = String(data.ownerName ?? '');
      const relationship = String(data.relationship ?? '');
      const token = String(data.token ?? '');
      await sendBeneficiaryInvite(ownerName, email, relationship, token);
      return;
    }
    case 'vote-request': {
      const ownerName = String(data.ownerName ?? '');
      await sendVoteRequest(ownerName, [email]);
      return;
    }
    case 'owner-notification': {
      const ownerName = String(data.ownerName ?? email);
      const beneficiaryName = String(data.beneficiaryName ?? 'المستفيد');
      const notifCount = Number(data.notifCount ?? 1);
      const aliveUrl = String(data.aliveUrl ?? '');
      await sendOwnerNotification(email, ownerName, beneficiaryName, notifCount, aliveUrl);
      return;
    }
    case 'beneficiary-absent': {
      const ownerName = String(data.ownerName ?? email);
      await sendBeneficiaryOwnerAbsent(email, ownerName);
      return;
    }
    default:
      throw new Error(`Unsupported retry type: ${type}`);
  }
}

async function addToRetryQueue(
  type: RetryType,
  email: string,
  data: Record<string, unknown>,
  attemptsMade: number,
  maxAttempts: number,
  nextRetryAt: number,
): Promise<void> {
  await db.insert(retryQueueTable).values({
    type,
    recipientEmail: email.toLowerCase(),
    data,
    attempts: attemptsMade,
    maxAttempts,
    lastAttemptAt: Date.now(),
    nextRetryAt,
    createdAt: Date.now(),
    status: 'pending',
  });
  logger.info(
    { type, email, attemptsMade, maxAttempts, nextRetryAt },
    'Email added to retry queue',
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function sendWithRetry(
  type: RetryType,
  email: string,
  data: Record<string, unknown>,
  maxAttempts = 3,
): Promise<{ success: boolean; error?: string }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sendEmailByType(type, email, data);
      logger.info({ type, email, attempt }, 'Email sent');
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ type, email, attempt, error: msg }, 'Email send attempt failed');

      if (attempt < maxAttempts) {
        const delay = Math.pow(4, attempt - 1) * 1000; // 1s, 4s, 16s
        const nextRetryAt = Date.now() + delay;
        await addToRetryQueue(type, email, data, attempt, maxAttempts, nextRetryAt);
        await sleep(delay);
      }
    }
  }

  const error = 'Max retries exceeded';
  logger.error({ type, email, maxAttempts }, error);
  return { success: false, error };
}

export async function processRetryQueue(): Promise<void> {
  const now = Date.now();
  const pending = await db
    .select()
    .from(retryQueueTable)
    .where(
      and(
        eq(retryQueueTable.status, 'pending'),
        lte(retryQueueTable.nextRetryAt, now),
        gt(retryQueueTable.maxAttempts, retryQueueTable.attempts),
      ),
    );

  if (pending.length === 0) return;

  logger.info({ count: pending.length }, 'Retry queue: processing pending items');

  for (const item of pending) {
    const nextAttempt = item.attempts + 1;
    try {
      await sendEmailByType(item.type as RetryType, item.recipientEmail, item.data as Record<string, unknown>);
      await db
        .update(retryQueueTable)
        .set({ status: 'completed', attempts: nextAttempt, lastAttemptAt: now })
        .where(eq(retryQueueTable.id, item.id));
      logger.info(
        { id: item.id, type: item.type, email: item.recipientEmail, attempt: nextAttempt },
        'Retry queue: email sent successfully',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const exhausted = nextAttempt >= item.maxAttempts;
      if (exhausted) {
        await db
          .update(retryQueueTable)
          .set({ status: 'failed', attempts: nextAttempt, lastAttemptAt: now })
          .where(eq(retryQueueTable.id, item.id));
        logger.error(
          { id: item.id, type: item.type, email: item.recipientEmail, attempts: nextAttempt, error: msg },
          'Retry queue: max attempts exceeded',
        );
      } else {
        const nextRetryAt = now + Math.pow(4, item.attempts) * 1000;
        await db
          .update(retryQueueTable)
          .set({ attempts: nextAttempt, lastAttemptAt: now, nextRetryAt })
          .where(eq(retryQueueTable.id, item.id));
        logger.warn(
          { id: item.id, type: item.type, email: item.recipientEmail, attempt: nextAttempt, nextRetryAt, error: msg },
          'Retry queue: attempt failed, will retry',
        );
      }
    }
  }
}

// Retry queue scheduler: every 5 minutes re-process failed/pending emails.
setInterval(() => {
  processRetryQueue().catch(err =>
    logger.error({ err }, 'Retry queue scheduler failed'),
  );
}, 5 * 60 * 1000);

logger.info('Email retry queue scheduler started (interval: 5 min)');

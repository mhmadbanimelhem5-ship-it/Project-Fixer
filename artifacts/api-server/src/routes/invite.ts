import { Router } from 'express';
import { getToken, updateTokenStatus } from '../lib/emailService';

const router = Router();

function page(titleText: string, icon: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${titleText} — Auryx</title>
  <style>
    *{box-sizing:border-box}
    body{background:#0A0F1E;color:#E2E8F0;font-family:Arial,Helvetica,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:rgba(255,255,255,0.05);border:1px solid rgba(212,175,55,0.25);border-radius:20px;max-width:480px;width:100%;padding:44px 36px;text-align:center}
    .logo{font-size:24px;font-weight:700;color:#D4AF37;letter-spacing:3px;margin-bottom:6px}
    .tagline{font-size:12px;color:#64748B;margin-bottom:36px}
    .icon{font-size:60px;margin-bottom:20px;line-height:1}
    h1{font-size:22px;font-weight:700;color:#E2E8F0;margin:0 0 14px}
    p{font-size:14px;color:#94A3B8;line-height:1.7;margin:0 0 10px}
    .footer{margin-top:32px;font-size:11px;color:#334155}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">⬡ Auryx</div>
    <div class="tagline">عالمك. محمي للأبد.</div>
    <div class="icon">${icon}</div>
    <h1>${titleText}</h1>
    ${bodyHtml}
    <div class="footer">هذا رد تلقائي — لا تحتاج لاتخاذ أي إجراء آخر.</div>
  </div>
</body>
</html>`;
}

function errorPage(err: unknown): string {
  return page('خطأ', '❌', '<p>حدث خطأ أثناء معالجة الطلب. يرجى المحاولة مرة أخرى لاحقاً.</p>');
}

// GET /api/invite/accept/:token
router.get('/accept/:token', async (req, res) => {
  try {
    const inv = await getToken(req.params.token);

    if (!inv) {
      return void res.status(410).send(
        page('رابط غير صالح', '❌', '<p>هذا الرابط غير صالح أو انتهت صلاحيته (7 أيام).</p>')
      );
    }

    if (inv.status !== 'pending') {
      const msg = inv.status === 'accepted'
        ? 'لقد وافقت بالفعل على هذه الدعوة.'
        : 'لقد رفضت هذه الدعوة مسبقاً.';
      return void res.send(page('تم الرد مسبقاً', 'ℹ️', `<p>${msg}</p>`));
    }

    await updateTokenStatus(req.params.token, 'accepted');

    const msg = inv.type === 'guardian-invite'
      ? `وافقت على أن تكون وصياً على بيانات الخزنة الخاصة بـ <strong style="color:#D4AF37">${inv.ownerName}</strong>.`
      : `وافقت على أن تكون المستفيد النهائي لخزنة <strong style="color:#D4AF37">${inv.ownerName}</strong>.`;

    res.send(page('تمت الموافقة', '✅', `<p>${msg}</p><p>سيتم إخطار صاحب الخزنة قريباً.</p>`));
  } catch (err) {
    req.log.error({ err, token: req.params.token }, 'Invite accept failed');
    res.status(500).send(errorPage(err));
  }
});

// GET /api/invite/reject/:token
router.get('/reject/:token', async (req, res) => {
  try {
    const inv = await getToken(req.params.token);

    if (!inv) {
      return void res.status(410).send(
        page('رابط غير صالح', '❌', '<p>هذا الرابط غير صالح أو انتهت صلاحيته.</p>')
      );
    }

    if (inv.status !== 'pending') {
      return void res.send(
        page('تم الرد مسبقاً', 'ℹ️', '<p>لقد سبق أن رددت على هذه الدعوة.</p>')
      );
    }

    await updateTokenStatus(req.params.token, 'rejected');

    res.send(
      page('تم الرفض', '🚫',
        `<p>تم رفض الدعوة من <strong style="color:#D4AF37">${inv.ownerName}</strong>.</p>` +
        `<p>لن يتم تعيينك ${inv.type === 'guardian-invite' ? 'وصياً' : 'مستفيداً نهائياً'}.</p>`)
    );
  } catch (err) {
    req.log.error({ err, token: req.params.token }, 'Invite reject failed');
    res.status(500).send(errorPage(err));
  }
});

// GET /api/invite/status/:token — checked by the Expo app to see if invite was accepted
router.get('/status/:token', async (req, res) => {
  try {
    const inv = await getToken(req.params.token);
    if (!inv) return void res.status(404).json({ status: 'expired' });
    res.json({ status: inv.status, type: inv.type });
  } catch (err) {
    req.log.error({ err, token: req.params.token }, 'Invite status check failed');
    res.status(500).send(errorPage(err));
  }
});

export default router;

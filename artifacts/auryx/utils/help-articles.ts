/**
 * help-articles.ts — Central knowledge base content (bilingual).
 *
 * All help content lives here (not in translation JSONs) so it can be
 * maintained in one place. The help screen picks the active language
 * via useLanguage().
 *
 * Structure: Categories → Articles. Each article has:
 *   - id        : stable identifier
 *   - title     : { ar, en }
 *   - body      : { ar, en }  (max ~6 lines, \n separated)
 *   - keywords  : { ar, en }  (extra search terms not present in title/body)
 */

export type HelpLang = 'ar' | 'en';

export interface HelpArticle {
  id: string;
  title: Record<HelpLang, string>;
  body: Record<HelpLang, string>;
  keywords: Record<HelpLang, string>;
}

export interface HelpCategory {
  id: string;
  icon: string;          // Feather icon name
  color: string;         // hex accent
  title: Record<HelpLang, string>;
  articles: HelpArticle[];
}

export const HELP_CATEGORIES: HelpCategory[] = [
  // ─── 1. Vault ────────────────────────────────────────────────────────────
  {
    id: 'vault',
    icon: 'home',
    color: '#60A5FA',
    title: { ar: 'الخزنة', en: 'The Vault' },
    articles: [
      {
        id: 'vault-what',
        title: { ar: 'ما هي خزنة Auryx؟', en: 'What is the Auryx Vault?' },
        body: {
          ar:
            'خزنتك مساحة مشفرة تعيش على جهازك فقط، تحفظ فيها بياناتك الحساسة ككلمات المرور والوثائق والوصايا.\n' +
            'كل شيء يُشفَّر بمعيار AES-256 بمفتاح يُشتق من رمز دخولك، ولا تصل أي نسخة مقروءة لخوادمنا.\n' +
            'حتى فريق Auryx نفسه لا يستطيع فتح خزنتك أو قراءة محتواها.\n' +
            'إذا حذفت التطبيق أو فقدت جهازك دون نسخة احتياطية، لا يمكن استرجاع المحتوى — هذه ضريبة التشفير الحقيقي.',
          en:
            'Your vault is an encrypted space that lives only on your device, storing sensitive data like passwords, documents and wills.\n' +
            'Everything is encrypted with AES-256 using a key derived from your PIN; no readable copy ever reaches our servers.\n' +
            'Even the Auryx team cannot open your vault or read its contents.\n' +
            'If you delete the app or lose your device without a backup, the content cannot be recovered — the price of true encryption.',
        },
        keywords: { ar: 'تشفير، تخزين، بيانات، أمان', en: 'encryption, storage, data, security' },
      },
      {
        id: 'vault-items',
        title: { ar: 'إضافة وتعديل العناصر', en: 'Adding & editing items' },
        body: {
          ar:
            'من الشاشة الرئيسية اضغط زر "+" لإضافة عنصر جديد.\n' +
            'اختر التصنيف المناسب (حساب، وثيقة، ملاحظة...) ثم أدخل بياناتك.\n' +
            'استخدم شريط البحث بالأعلى للوصول الفوري لأي عنصر.\n' +
            'للتعديل أو الحذف: افتح العنصر واختر تعديل، أو اضغط عليه مطولاً.\n' +
            'كل تغيير يُحفظ تلقائياً ومشفرًا خلال ثوانٍ.',
          en:
            'From the home screen tap the "+" button to add a new item.\n' +
            'Pick the right category (account, document, note...) then enter your data.\n' +
            'Use the search bar at the top for instant access to any item.\n' +
            'To edit or delete: open the item and choose edit, or long-press it.\n' +
            'Every change is saved automatically and encrypted within seconds.',
        },
        keywords: { ar: 'عنصر، إضافة، حذف، تصنيف، بحث', en: 'item, add, delete, category, search' },
      },
      {
        id: 'vault-backup',
        title: { ar: 'النسخ الاحتياطي المشفر', en: 'Encrypted backup' },
        body: {
          ar:
            'من الإعدادات ← النسخ الاحتياطي، اضغط "تصدير نسخة مشفرة".\n' +
            'ستحصل على نص مشفر بـ AES-256 احفظه بمكان آمن (مدير كلمات مرور أو خزنة بنكية).\n' +
            'للاستعادة: ثبّت التطبيق على جهاز جديد واختر "استيراد من نسخة" أثناء الإعداد.\n' +
            'بدون رمز دخولك تبقى النسخة غير قابلة للقراءة من أي شخص.\n' +
            'حدّث نسختك بعد كل إضافة مهمة لعناصر جديدة.',
          en:
            'In Settings ← Backup, tap "Export encrypted backup".\n' +
            'You get an AES-256 encrypted text; store it somewhere safe (password manager or bank safe).\n' +
            'To restore: install the app on a new device and choose "Import from backup" during setup.\n' +
            'Without your PIN the backup stays unreadable to anyone.\n' +
            'Refresh your copy after adding important new items.',
        },
        keywords: { ar: 'نسخة، تصدير، استيراد، استعادة، ملف', en: 'backup, export, import, restore, file' },
      },
    ],
  },

  // ─── 2. Guardians ────────────────────────────────────────────────────────
  {
    id: 'guardians',
    icon: 'users',
    color: '#A78BFA',
    title: { ar: 'الأوصياء', en: 'Guardians' },
    articles: [
      {
        id: 'guard-what',
        title: { ar: 'من هو الوصي وما دوره؟', en: 'What is a guardian?' },
        body: {
          ar:
            'الوصي شخص تثق به (صديق مقرب، أخ، محامٍ) يساعد على حماية إرثك الرقمي عند غيابك.\n' +
            'لا يستطيع الوصي قراءة محتوى خزنتك أبداً — دوره يقتصر على الموافقة أو الرفض في بروتوكول الإرث.\n' +
            'تصل الوصي دعوة عبر البريد، وعند قبولها يُربط جهازه بخزنتك تشفيرياً.\n' +
            'اختر أوصياء يعرفونك ويفضّل أن يعرفوا بعضهم، لتقليل خطر التواطؤ الفردي.',
          en:
            'A guardian is someone you trust (close friend, sibling, lawyer) who helps protect your digital legacy if you are absent.\n' +
            'A guardian can never read your vault content — their role is limited to approving or rejecting in the legacy protocol.\n' +
            'Guardians receive an email invite; upon accepting, their device is cryptographically linked to your vault.\n' +
            'Choose guardians who know you and ideally each other, to reduce single-person collusion risk.',
        },
        keywords: { ar: 'وصي، ثقة، حماية، دور', en: 'guardian, trust, protection, role' },
      },
      {
        id: 'guard-add',
        title: { ar: 'إضافة وصي جديد', en: 'Adding a guardian' },
        body: {
          ar:
            'من تبويب "الأوصياء" اضغط "إضافة وصي".\n' +
            'أدخل الاسم والبريد الإلكتروني ثم أرسل الدعوة.\n' +
            'تبقى حالة الوصي "معلّق" حتى يقبل الدعوة ويفتح التطبيق على جهازه.\n' +
            'بعد القبول تتحول الحالة إلى "نشط" ويصبح جزءاً من منظومة الحماية.\n' +
            'يمكنك إزالة أي وصي في أي وقت من نفس الشاشة.',
          en:
            'In the "Guardians" tab tap "Add guardian".\n' +
            'Enter their name and email, then send the invite.\n' +
            'Their status stays "pending" until they accept the invite and open the app on their device.\n' +
            'Once accepted, the status becomes "active" and they join your protection circle.\n' +
            'You can remove any guardian at any time from the same screen.',
        },
        keywords: { ar: 'دعوة، بريد، قبول، حالة', en: 'invite, email, accept, status' },
      },
      {
        id: 'guard-threshold',
        title: { ar: 'حد الموافقة (Threshold)', en: 'Approval threshold' },
        body: {
          ar:
            'حد الموافقة هو عدد الأوصياء المطلوب لتفعيل نقل الإرث (مثلاً 2 من 3).\n' +
            'يحميك هذا الرقم من وصي واحد مارق أو من بريد إلكتروني مخترق.\n' +
            'القاعدة المقترحة: اختر رقماً يساوي نصف عدد الأوصياء + 1.\n' +
            'لا يمكن تغيير الحد بعد تفعيل الإرث دون إعادة الإعداد من جديد.',
          en:
            'The threshold is the number of guardians required to trigger the legacy transfer (e.g. 2 of 3).\n' +
            'This number protects you from a single rogue guardian or a compromised inbox.\n' +
            'Recommended rule: choose half of your guardians plus one.\n' +
            'The threshold cannot be changed after legacy activation without a full re-setup.',
        },
        keywords: { ar: 'حد، موافقة، تصويت، رقم', en: 'threshold, approval, vote, number' },
      },
      {
        id: 'guard-remove',
        title: { ar: 'إزالة وصي', en: 'Removing a guardian' },
        body: {
          ar:
            'افتح بطاقة الوصي واضغط "إزالة".\n' +
            'يصل الوصي بريد يبلغه بالإزالة، وتُحذف مفاتيحه من منظومتك فوراً.\n' +
            'إذا كان الإرث مفعّلاً، تأكد أن الحد ما زال منطقياً مع عدد الأوصياء المتبقي.\n' +
            'الإزالة لا تلغي أي موافقات صدرت في بروتوكول جارٍ حالياً.',
          en:
            'Open the guardian card and tap "Remove".\n' +
            'The guardian receives a notification email and their keys are deleted from your system instantly.\n' +
            'If legacy is active, make sure the threshold still makes sense with the remaining guardians.\n' +
            'Removal does not cancel approvals already cast in an ongoing protocol.',
        },
        keywords: { ar: 'حذف، إزالة، مفاتيح', en: 'delete, remove, keys' },
      },
    ],
  },

  // ─── 3. Digital Legacy ───────────────────────────────────────────────────
  {
    id: 'legacy',
    icon: 'shield',
    color: '#D4AF37',
    title: { ar: 'الإرث الرقمي', en: 'Digital Legacy' },
    articles: [
      {
        id: 'legacy-protocol',
        title: { ar: 'كيف يعمل بروتوكول الغياب (48 ساعة)', en: 'How the absence protocol works (48h)' },
        body: {
          ar:
            'إذا توقفت عن فتح التطبيق لمدة "أيام الغياب" التي اخترتها، يبدأ البروتوكول تلقائياً.\n' +
            'خلال 48 ساعة يصلك إشعار كل 3 ساعات على بريدك للتأكد أنك بخير.\n' +
            'إذا لم تستجب، يُطلب من الأوصياء التصويت على نقل الإرث.\n' +
            'عند بلوغ حد الموافقات تُفتح الحزمة المشفرة للمستفيد فقط.\n' +
            'يمكنك إيقاف البروتوكول في أي لحظة بمجرد فتح التطبيق.',
          en:
            'If you stop opening the app for your chosen "absence days", the protocol starts automatically.\n' +
            'For 48 hours you receive an email reminder every 3 hours to confirm you are fine.\n' +
            'If you do not respond, guardians are asked to vote on the legacy transfer.\n' +
            'Once the approval threshold is reached, the sealed package opens for the beneficiary only.\n' +
            'You can stop the protocol at any moment simply by opening the app.',
        },
        keywords: { ar: 'غياب، 48 ساعة، تصويت، بروتوكول', en: 'absence, 48 hours, vote, protocol' },
      },
      {
        id: 'legacy-layers',
        title: { ar: 'الطبقات الثلاث للتشفير', en: 'The three encryption layers' },
        body: {
          ar:
            'الطبقة 1: محتوى الخزنة يُشفَّر بمفتاح نقل عشوائي (AES-256).\n' +
            'الطبقة 2: مفتاح النقل يُشفَّر بالمفتاح العام للمستفيد — جهازه فقط يفكّه.\n' +
            'الطبقة 3: مفتاح النقل يُقسَّم بين الأوصياء بنظام Shamir — يلزم بلوغ الحد لإعادة تركيبه.\n' +
            'بهذا لا توجد نقطة فشل واحدة: لا الخادم ولا وصي منفرد يملك المفتاح كاملاً.',
          en:
            'Layer 1: vault content is encrypted with a random transfer key (AES-256).\n' +
            'Layer 2: the transfer key is encrypted with the beneficiary public key — only their device decrypts it.\n' +
            'Layer 3: the transfer key is split among guardians via Shamir — the threshold is needed to reconstruct it.\n' +
            'There is no single point of failure: neither the server nor a lone guardian holds the full key.',
        },
        keywords: { ar: 'طبقات، AES، RSA، شامير، مفتاح', en: 'layers, AES, RSA, shamir, key' },
      },
      {
        id: 'legacy-beneficiary',
        title: { ar: 'المستفيد (Beneficiary)', en: 'The beneficiary' },
        body: {
          ar:
            'المستفيد هو الشخص الذي يستلم خزنتك بعد تأكيد غيابك (زوج/زوجة، ابن، صديق).\n' +
            'أضفه من شاشة الإرث بالاسم والبريد؛ تصله دعوة لتثبيت التطبيق وتسجيل مفتاحه العام.\n' +
            'إذا لم يسجّل مفتاحه في الوقت المناسب، يعتمد النقل على تصويت الأوصياء (الطبقة 3).\n' +
            'يمكنك تغيير المستفيد أو حذفه في أي وقت قبل تفعيل النقل.',
          en:
            'The beneficiary is the person who receives your vault after your absence is confirmed (spouse, child, friend).\n' +
            'Add them in the legacy screen with name and email; they get an invite to install the app and register their public key.\n' +
            'If they do not register their key in time, the transfer falls back to guardian voting (Layer 3).\n' +
            'You can change or remove the beneficiary any time before the transfer is triggered.',
        },
        keywords: { ar: 'مستفيد، وريث، نقل، دعوة', en: 'beneficiary, heir, transfer, invite' },
      },
      {
        id: 'legacy-seal',
        title: { ar: 'زر "إغلاق الخزنة الآن"', en: 'The "Seal vault now" button' },
        body: {
          ar:
            'ينشئ هذا الزر لقطة مشفرة من محتوى خزنتك الحالي ويرفعها إلى الخادم.\n' +
            'لا يُقفل جلستك ولا يمنعك من متابعة استخدام التطبيق بشكل طبيعي.\n' +
            'كلما أضفت بيانات مهمة اضغطه مجدداً لتحديث الحزمة المشفرة.\n' +
            'بدون هذه الخطوة قد يستلم المستفيد نسخة قديمة من خزنتك.',
          en:
            'This button creates an encrypted snapshot of your current vault and uploads it to the server.\n' +
            'It does not lock your session or stop you from using the app normally.\n' +
            'After adding important data, press it again to refresh the sealed package.\n' +
            'Without this step the beneficiary may receive an outdated copy of your vault.',
        },
        keywords: { ar: 'إغلاق، ختم، تحديث، حزمة', en: 'seal, lock, refresh, package' },
      },
      {
        id: 'legacy-indicators',
        title: { ar: 'مؤشرات الغياب وإيقاف البروتوكول', en: 'Absence indicators & stopping the protocol' },
        body: {
          ar:
            'بعد انتهاء أيام الغياب يبدأ عدّاد 48 ساعة تلقائياً.\n' +
            'خلالها يصلك بريد كل 3 ساعات؛ فتح التطبيق يصفّر كل شيء فوراً.\n' +
            'إذا كنت مسافراً أو بلا إنترنت، افتح التطبيق مرة واحدة عند العودة لإيقاف البروتوكول.\n' +
            'لا يستطيع الأوصياء بدء التصويت قبل انتهاء نافذة الـ 48 ساعة كاملة.',
          en:
            'After your absence days elapse, a 48-hour counter starts automatically.\n' +
            'During it you get an email every 3 hours; opening the app resets everything instantly.\n' +
            'If you are traveling or offline, open the app once when back to stop the protocol.\n' +
            'Guardians cannot start voting before the full 48-hour window ends.',
        },
        keywords: { ar: 'سفر، إنترنت، إيقاف، عدّاد', en: 'travel, offline, stop, counter' },
      },
    ],
  },

  // ─── 4. PIN Recovery ─────────────────────────────────────────────────────
  {
    id: 'recovery',
    icon: 'key',
    color: '#34D399',
    title: { ar: 'استعادة رمز الدخول', en: 'PIN Recovery' },
    articles: [
      {
        id: 'rec-methods',
        title: { ar: 'طريقتا الاستعادة', en: 'The two recovery methods' },
        body: {
          ar:
            'الطريقة 1 — الأوصياء: طلب تصويت، وعند بلوغ الحد يصلك رمز OTP لتعيين رمز جديد.\n' +
            'الطريقة 2 — إيميل الاسترجاع: رمز OTP فوري إلى بريدك المسجّل مسبقاً.\n' +
            'استخدم الطريقة 2 للسرعة، والطريقة 1 إذا لم يعد لديك وصول لإيميل الاسترجاع.\n' +
            'كلتا الطريقتين تغيّران رمز الدخول فقط ولا تمسان محتوى الخزنة.',
          en:
            'Method 1 — Guardians: request a vote; once the threshold is reached you get an OTP to set a new PIN.\n' +
            'Method 2 — Recovery email: instant OTP to your pre-registered email.\n' +
            'Use method 2 for speed, method 1 if you no longer have access to your recovery email.\n' +
            'Both methods only change the PIN; vault content is never touched.',
        },
        keywords: { ar: 'استعادة، نسيان، رمز، طرق', en: 'recovery, forgot, PIN, methods' },
      },
      {
        id: 'rec-guardians',
        title: { ar: 'الاستعادة عبر الأوصياء', en: 'Recovery via guardians' },
        body: {
          ar:
            'من شاشة القفل اضغط "نسيت الرقم؟" ثم اختر "عبر الأوصياء".\n' +
            'يُرسل طلب تصويت لأوصيائك مع روابط موافقة/رفض فردية لكل وصي.\n' +
            'عند بلوغ حد الموافقات يصلك رمز OTP على بريدك الرئيسي.\n' +
            'أدخل الرمز ثم عيّن رمز دخول جديد.\n' +
            'مهلة الطلب 72 ساعة قبل انتهاء صلاحيته.',
          en:
            'From the lock screen tap "Forgot PIN?" then choose "Via guardians".\n' +
            'A vote request with individual approve/reject links is sent to your guardians.\n' +
            'Once the threshold is reached, an OTP arrives at your main email.\n' +
            'Enter the code, then set a new PIN.\n' +
            'The request expires after 72 hours.',
        },
        keywords: { ar: 'تصويت، أوصياء، 72 ساعة', en: 'vote, guardians, 72 hours' },
      },
      {
        id: 'rec-email',
        title: { ar: 'الاستعادة عبر إيميل الاسترجاع', en: 'Recovery via recovery email' },
        body: {
          ar:
            'فعّل الإيميل مسبقاً من: الإعدادات ← الأمان ← إيميل الاسترجاع.\n' +
            'عند الحاجة: شاشة القفل ← "نسيت الرقم؟" ← "عبر إيميل الاسترجاع".\n' +
            'أدخل بريدك المسجّل، يصلك رمز من 6 أرقام، أدخله ثم عيّن رمزاً جديداً.\n' +
            'الرمز الصالح هو دائماً رمز آخر بريد وصلك — كل طلب جديد يلغي السابق.\n' +
            'بريدك يُخزَّن مجزّأً (Hash) ولا يمكن لأحد قراءته من قاعدة البيانات.',
          en:
            'Enable it beforehand: Settings ← Security ← Recovery email.\n' +
            'When needed: lock screen ← "Forgot PIN?" ← "Via recovery email".\n' +
            'Enter your registered email, receive a 6-digit code, enter it, then set a new PIN.\n' +
            'The valid code is always from the latest email — each new request invalidates the previous one.\n' +
            'Your email is stored as a hash; nobody can read it from the database.',
        },
        keywords: { ar: 'OTP، بريد، تحقق، رمز', en: 'OTP, email, verify, code' },
      },
    ],
  },

  // ─── 5. Decoy Vault ──────────────────────────────────────────────────────
  {
    id: 'decoy',
    icon: 'eye-off',
    color: '#F472B6',
    title: { ar: 'الخزنة الوهمية', en: 'Decoy Vault' },
    articles: [
      {
        id: 'decoy-what',
        title: { ar: 'ما هي الخزنة الوهمية؟', en: 'What is the decoy vault?' },
        body: {
          ar:
            'خزنة ثانية بمظهر حقيقي تماماً، تُفتح برمز دخول مختلف (PIN وهمي).\n' +
            'تستخدمها إذا أُجبرت على فتح تطبيقك أمام شخص لا تثق به.\n' +
            'تحتوي عناصر عادية غير حساسة، بينما تبقى خزنتك الحقيقية مخفية تماماً.\n' +
            'لا يوجد أي مؤشر في الواجهة يكشف وجود خزنة حقيقية خلفها.',
          en:
            'A second, fully realistic vault opened with a different PIN (decoy PIN).\n' +
            'Use it if you are forced to open your app in front of someone you do not trust.\n' +
            'It holds ordinary, non-sensitive items while your real vault stays completely hidden.\n' +
            'No UI indicator reveals that a real vault exists behind it.',
        },
        keywords: { ar: 'وهمية، إجبار، ضغط، إخفاء', en: 'decoy, coercion, duress, hide' },
      },
      {
        id: 'decoy-setup',
        title: { ar: 'تفعيل PIN الوهمي', en: 'Enabling the decoy PIN' },
        body: {
          ar:
            'من الإعدادات ← الأمان ← الخزنة الوهمية.\n' +
            'عيّن رمزاً مختلفاً تماماً عن رمزك الحقيقي وسهل التذكر تحت الضغط.\n' +
            'عند إدخال الـ PIN الوهمي في شاشة القفل تفتح الخزنة الوهمية مباشرة.\n' +
            'للتعطيل: من نفس المسار أطفئ المفتاح.',
          en:
            'Settings ← Security ← Decoy vault.\n' +
            'Set a PIN completely different from your real one and easy to recall under pressure.\n' +
            'Entering the decoy PIN on the lock screen opens the decoy vault directly.\n' +
            'To disable: same path, toggle it off.',
        },
        keywords: { ar: 'تفعيل، رمز وهمي، إعداد', en: 'enable, decoy PIN, setup' },
      },
    ],
  },

  // ─── 6. Stealth Mode ─────────────────────────────────────────────────────
  {
    id: 'stealth',
    icon: 'cpu',
    color: '#22D3EE',
    title: { ar: 'وضع التخفي', en: 'Stealth Mode' },
    articles: [
      {
        id: 'stealth-calc',
        title: { ar: 'واجهة الحاسبة', en: 'The calculator disguise' },
        body: {
          ar:
            'عند تفعيل وضع التخفي تتحول شاشة القفل إلى حاسبة حقيقية الشكل.\n' +
            'أدخل رمزك ثم اضغط "=" لفتح الخزنة — بقية العمليات تعمل كحاسبة فعلية.\n' +
            'لا يظهر أي شعار أو اسم للتطبيق في هذا الوضع.\n' +
            'مثالي للأجهزة المشتركة أو عند عبور نقاط التفتيش.',
          en:
            'With stealth mode on, the lock screen becomes a realistic calculator.\n' +
            'Type your PIN then press "=" to unlock — other operations work like a real calculator.\n' +
            'No app logo or name appears in this mode.\n' +
            'Ideal for shared devices or checkpoints.',
        },
        keywords: { ar: 'حاسبة، تخفي، إخفاء، شاشة', en: 'calculator, stealth, hide, screen' },
      },
      {
        id: 'stealth-intruder',
        title: { ar: 'كشف الدخيل', en: 'Intruder detection' },
        body: {
          ar:
            'بعد 9 محاولات إدخال خاطئة يلتقط التطبيق صورة سيلفي بالكاميرا الأمامية.\n' +
            'تُحفظ الصورة محلياً على جهازك وتُعرض لك عند الفتح التالي مع تنبيه أحمر.\n' +
            'يمكنك إرسالها لنفسك بالبريد كدليل.\n' +
            'الهدف ردع المتطفلين وتوثيق محاولات الوصول غير المشروع.',
          en:
            'After 9 wrong attempts the app captures a selfie with the front camera.\n' +
            'The photo is stored locally on your device and shown on next unlock with a red alert.\n' +
            'You can email it to yourself as evidence.\n' +
            'The goal is to deter snoopers and document unauthorized access attempts.',
        },
        keywords: { ar: 'سيلفي، صورة، دخيل، محاولات', en: 'selfie, photo, intruder, attempts' },
      },
    ],
  },

  // ─── 7. Security & Privacy ───────────────────────────────────────────────
  {
    id: 'privacy',
    icon: 'lock',
    color: '#F59E0B',
    title: { ar: 'الأمان والخصوصية', en: 'Security & Privacy' },
    articles: [
      {
        id: 'priv-e2e',
        title: { ar: 'التشفير طرف لطرف', en: 'End-to-end encryption' },
        body: {
          ar:
            'كل عمليات التشفير وفك التشفير تحدث على جهازك فقط.\n' +
            'الخادم يستقبل حزم مشفرة لا يستطيع قراءتها أو تعديلها دون كشف التلاعب.\n' +
            'مفاتيح فك التشفير لا تُرسل ولا تُخزَّن خارج جهازك أبداً.\n' +
            'هذا يعني أن تسريب خوادمنا — لا قدّر الله — لن يكشف أي بيانات مقروءة.',
          en:
            'All encryption and decryption happens on your device only.\n' +
            'The server receives sealed packages it cannot read or tamper with undetected.\n' +
            'Decryption keys are never sent or stored outside your device.\n' +
            'This means a server breach — God forbid — would expose no readable data.',
        },
        keywords: { ar: 'طرف لطرف، خوادم، تسريب', en: 'end-to-end, servers, breach' },
      },
      {
        id: 'priv-rsa',
        title: { ar: 'مفاتيح RSA-2048', en: 'RSA-2048 keys' },
        body: {
          ar:
            'عند أول تشغيل يولّد التطبيق زوج مفاتيح RSA-2048 على جهازك.\n' +
            'المفتاح العام يُرفع للخادم ليستخدمه المرسلون (المستفيد/الأوصياء) في التشفير لك.\n' +
            'المفتاح الخاص يبقى في التخزين الآمن لجهازك (Keystore/Keychain) ولا يغادره أبداً.\n' +
            'لهذا لا يمكن نقل الخزنة لجهاز جديد بدون نسخة احتياطية أو بروتوكول الإرث.',
          en:
            'On first launch the app generates an RSA-2048 key pair on your device.\n' +
            'The public key is uploaded so senders (beneficiary/guardians) can encrypt to you.\n' +
            'The private key stays in your device secure storage (Keystore/Keychain) and never leaves.\n' +
            'This is why the vault cannot move to a new device without a backup or the legacy protocol.',
        },
        keywords: { ar: 'مفتاح عام، خاص، keystore', en: 'public key, private, keystore' },
      },
      {
        id: 'priv-pin',
        title: { ar: 'حماية رمز الدخول', en: 'PIN protection' },
        body: {
          ar:
            'رمز دخولك لا يُخزَّن أبداً، ولا حتى بشكل مشفر.\n' +
            'يُشتق منه مفتاح الخزنة عبر PBKDF2 مع Salt عشوائي و10,000 تكرار.\n' +
            'محاولات التخمين تُبطأ عمداً، وبعد 3/6/9 محاولات تُفعَّل أقفال زمنية ثم كشف الدخيل.\n' +
            'البصمة والوجه وسيلتا فتح مريحتان — المرجع النهائي يبقى الـ PIN.',
          en:
            'Your PIN is never stored, not even encrypted.\n' +
            'The vault key is derived from it via PBKDF2 with a random salt and 10,000 iterations.\n' +
            'Brute-force attempts are deliberately slowed; after 3/6/9 tries time-locks then intruder detection activate.\n' +
            'Biometrics are convenience only — the PIN remains the final authority.',
        },
        keywords: { ar: 'PBKDF2، بصمة، وجه، محاولات', en: 'PBKDF2, biometrics, face, attempts' },
      },
      {
        id: 'priv-data',
        title: { ar: 'البيانات التي نجمعها — ولماذا', en: 'Data we collect — and why' },
        body: {
          ar:
            'نجمع الحد الأدنى الضروري لتشغيل الخدمة فقط:\n' +
            '• بريدك واسمك (عبر Clerk) لتسجيل الدخول وإرسال الإشعارات.\n' +
            '• مفتاحك العام RSA وحزم الخزنة المشفرة لتنفيذ بروتوكول الإرث.\n' +
            '• حالة اشتراكك (عبر RevenueCat) لإدارة مميزات Premium.\n' +
            '• تجزئة (Hash) بريد الاسترجاع لتفعيل الاستعادة الذاتية.\n' +
            'لا نجمع أبداً: محتوى خزنتك، رمز دخولك، مفاتيحك الخاصة، موقعك، جهات اتصالك، أو صورك.\n' +
            'لا نبيع بيانات ولا نشاركها مع معلنين — نموذج ربحنا هو الاشتراك فقط.',
          en:
            'We collect only the minimum needed to run the service:\n' +
            '• Your email and name (via Clerk) for sign-in and notifications.\n' +
            '• Your RSA public key and sealed vault packages to execute the legacy protocol.\n' +
            '• Your subscription status (via RevenueCat) to manage Premium features.\n' +
            '• A hash of your recovery email to enable self-recovery.\n' +
            'We never collect: vault content, your PIN, private keys, location, contacts, or photos.\n' +
            'We do not sell or share data with advertisers — subscriptions are our only business model.',
        },
        keywords: { ar: 'خصوصية، بيانات، جمع، سياسة، Clerk', en: 'privacy, data, collection, policy, Clerk' },
      },
    ],
  },

  // ─── 8. Premium ──────────────────────────────────────────────────────────
  {
    id: 'premium',
    icon: 'star',
    color: '#D4AF37',
    title: { ar: 'اشتراك Premium', en: 'Premium Subscription' },
    articles: [
      {
        id: 'prem-features',
        title: { ar: 'مميزات Premium', en: 'Premium features' },
        body: {
          ar:
            'الإرث الرقمي الكامل: أوصياء + مستفيد + بروتوكول غياب 48 ساعة.\n' +
            'الخزنة الوهمية ووضع التخفي المتقدمان.\n' +
            'عدد أوصياء أكبر وحد موافقات مرن.\n' +
            'دعم ذو أولوية وتحديثات مبكرة للميزات الجديدة.',
          en:
            'Full digital legacy: guardians + beneficiary + 48-hour absence protocol.\n' +
            'Advanced decoy vault and stealth mode.\n' +
            'More guardians and flexible approval thresholds.\n' +
            'Priority support and early access to new features.',
        },
        keywords: { ar: 'بريميوم، مميزات، اشتراك', en: 'premium, features, subscription' },
      },
      {
        id: 'prem-restore',
        title: { ar: 'استعادة المشتريات', en: 'Restoring purchases' },
        body: {
          ar:
            'من الإعدادات ← الاشتراك ← "استعادة المشتريات".\n' +
            'يتم التحقق عبر RevenueCat المرتبط بحساب Clerk الخاص بك.\n' +
            'على Android تأكد أنك مسجل بنفس حساب Google Play.\n' +
            'إذا استمرت المشكلة راسل الدعم مع بريد حسابك.',
          en:
            'Settings ← Subscription ← "Restore purchases".\n' +
            'Verification runs via RevenueCat linked to your Clerk account.\n' +
            'On Android make sure you are signed into the same Google Play account.\n' +
            'If the issue persists, contact support with your account email.',
        },
        keywords: { ar: 'استعادة، شراء، Google Play', en: 'restore, purchase, Google Play' },
      },
    ],
  },
];
import { ArrowRight, Shield } from "lucide-react"
import { Link } from "wouter"
import type { ReactNode } from "react"

export function Privacy() {
  return (
    <LegalLayout title="سياسة الخصوصية" eyebrow="خصوصيتك أولاً">
      <p className="lead">
        آخر تحديث: 2 أغسطس 2026
      </p>
      <p>
        توضح هذه السياسة كيف يتعامل Auryx مع البيانات عند التسجيل في قائمة انتظار
        الإطلاق واستخدام خدماتنا. نهدف إلى جمع أقل قدر ممكن من البيانات اللازمة
        لتشغيل الخدمة.
      </p>

      <h2>1. البيانات التي نجمعها</h2>
      <p>
        عند الانضمام إلى قائمة الانتظار، نجمع عنوان بريدك الإلكتروني وتاريخ
        التسجيل وحالة تأكيد البريد. نستخدم هذه البيانات لإرسال رسالة التأكيد،
        إدارة ترتيب التسجيل، والتواصل معك بشأن إطلاق Auryx والعرض المعلن.
      </p>

      <h2>2. تأكيد البريد وأهلية الخصم</h2>
      <p>
        لا يصبح التسجيل مؤكدًا إلا بعد الضغط على رابط التأكيد المرسل إلى بريدك.
        تُحسب أهلية خصم الإطلاق بناءً على ترتيب تأكيد البريد، وليس مجرد إرسال
        النموذج. العرض مخصص لأول 500 تسجيل مؤكد وفق الشروط المعلنة.
      </p>

      <h2>3. بيانات الخزنة داخل التطبيق</h2>
      <p>
        الخزنة العادية مصممة لتخزين البيانات محليًا على جهازك وبشكل مشفّر. لا
        نقرأ محتويات خزنتك ولا نملك مفتاح فتحها. عند تفعيل ميزة الإرث الرقمي أو
        الطوارئ، قد ينشئ التطبيق نسخة مشفّرة مخصصة للنقل إلى المستفيد وفق
        الإعدادات التي تختارها.
      </p>

      <h2>4. كيف نستخدم البيانات</h2>
      <ul>
        <li>إرسال رسالة تأكيد التسجيل والرسائل الضرورية المتعلقة بقائمة الانتظار.</li>
        <li>حساب ترتيب التسجيل المؤكد وتحديد أهلية العرض.</li>
        <li>حماية الخدمة من التسجيلات الآلية أو إساءة الاستخدام.</li>
        <li>تحسين الخدمة والرد على طلبات الدعم.</li>
      </ul>

      <h2>5. ما لا نفعله</h2>
      <p>
        لا نبيع عناوين البريد الإلكتروني ولا نستخدمها لإرسال إعلانات من جهات
        أخرى. لا نطلب منك إرسال كلمات المرور أو رموز فتح الخزنة عبر البريد أو
        نموذج قائمة الانتظار.
      </p>

      <h2>6. الاحتفاظ بالبيانات وطلبات الحذف</h2>
      <p>
        نحتفظ ببيانات قائمة الانتظار بالقدر اللازم لإدارة الإطلاق والعرض. يمكنك
        طلب تصحيح بياناتك أو حذفها عبر البريد الإلكتروني أدناه. قد يؤدي حذف
        السجل قبل الإطلاق إلى فقدان أهلية العرض المرتبطة به.
      </p>

      <h2>7. مزودو الخدمات</h2>
      <p>
        قد نستخدم مزودي خدمات موثوقين لتشغيل البريد الإلكتروني والاستضافة
        وقاعدة البيانات. يقتصر وصولهم على ما يلزم لتقديم الخدمة، ولا نمنحهم
        حق استخدام بياناتك لأغراضهم التسويقية.
      </p>

      <h2>8. التواصل والتحديثات</h2>
      <p>
        إذا كان لديك سؤال أو طلب متعلق بالخصوصية، تواصل معنا عبر{" "}
        <a href="mailto:myauryx@gmail.com">myauryx@gmail.com</a>. قد نحدّث هذه
        السياسة عند تغير الخدمة، وسنضع النسخة الأحدث على هذه الصفحة.
      </p>
    </LegalLayout>
  )
}

function LegalLayout({ title, eyebrow, children }: {
  title: string
  eyebrow: string
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans" dir="rtl">
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-[35%] -right-[15%] w-[80%] h-[70%] rounded-full opacity-[0.16] blur-[120px] bg-[radial-gradient(circle_at_center,_#D4AF37_0%,_#8B6D1A_25%,_transparent_70%)]" />
        <div className="absolute bottom-0 -left-[20%] w-[70%] h-[60%] rounded-full opacity-[0.08] blur-[130px] bg-[radial-gradient(circle_at_center,_#8B5CF6_0%,_transparent_60%)]" />
      </div>

      <header className="relative z-10 border-b border-white/[0.06] backdrop-blur-xl bg-black/20">
        <div className="mx-auto max-w-5xl px-4 md:px-8 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-primary/10 flex items-center justify-center border border-primary/20 shadow-[0_0_15px_rgba(212,175,55,0.2)]">
              <Shield className="w-6 h-6 text-primary" />
            </div>
            <span className="text-xl font-bold tracking-widest uppercase font-display text-white">AURYX</span>
          </Link>
          <Link href="/" className="flex items-center gap-2 text-sm text-white/60 hover:text-primary transition-colors">
            العودة للصفحة الرئيسية
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-3xl px-4 md:px-8 py-16 md:py-24">
        <div className="mb-10 text-center">
          <p className="text-sm font-bold text-primary mb-3">{eyebrow}</p>
          <h1 className="text-4xl md:text-5xl font-extrabold font-display text-white">{title}</h1>
        </div>
        <article className="glass-panel rounded-3xl border border-white/10 p-6 md:p-10 legal-content">
          {children}
        </article>
      </main>
    </div>
  )
}
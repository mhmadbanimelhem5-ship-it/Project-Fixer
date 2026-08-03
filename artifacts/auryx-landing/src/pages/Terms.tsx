import { Link } from "wouter"
import type { ReactNode } from "react"

export function Terms() {
  return (
    <TermsLayout>
      <p className="lead">آخر تحديث: 2 أغسطس 2026</p>
      <p>
        باستخدام صفحة Auryx أو الانضمام إلى قائمة انتظار الإطلاق، فإنك توافق
        على هذه الشروط. إذا لم توافق عليها، يرجى عدم إرسال بياناتك إلى قائمة
        الانتظار.
      </p>

      <h2>1. قائمة الانتظار</h2>
      <p>
        التسجيل في القائمة لا يعني شراء اشتراك ولا يضمن موعدًا محددًا لإطلاق
        التطبيق. يجب تأكيد البريد الإلكتروني حتى يُحتسب التسجيل ضمن ترتيب
        العرض.
      </p>

      <h2>2. عرض أول 500 شخص</h2>
      <p>
        يحصل أول 500 شخص يؤكدون بريدهم الإلكتروني، وفق الترتيب المسجل في
        النظام، على أهلية خصم 50% عند إطلاق الاشتراكات. ينتهي العرض عند اكتمال
        العدد. الأهلية لا تُنقل إلى شخص آخر، ويجب استخدام نفس البريد المؤكد
        عند إنشاء حساب التطبيق.
      </p>

      <h2>3. الأسعار والاشتراكات</h2>
      <p>
        الأسعار المعلنة حاليًا هي 5.99 دولار شهريًا و45.99 دولار سنويًا قبل
        الخصم، وقد تتغير قبل الإطلاق بعد إظهار السعر النهائي داخل Google Play.
        تُدار عملية الشراء والفوترة والإلغاء من خلال Google Play، وتطبق
        شروطه على عمليات الدفع والاسترداد.
      </p>

      <h2>4. طبيعة الخدمة</h2>
      <p>
        يقدم Auryx أدوات لحماية البيانات الشخصية وإدارة إجراءات الطوارئ
        والإرث الرقمي وفق الإعدادات التي يختارها المستخدم. الخدمة ليست بديلًا
        عن الاستشارة القانونية أو المالية أو الطبية، ويجب مراجعة إعدادات
        المستفيدين والأوصياء بعناية.
      </p>

      <h2>5. مسؤولية المستخدم</h2>
      <ul>
        <li>تقديم بريد إلكتروني تملكه وتستطيع الوصول إليه.</li>
        <li>الحفاظ على PIN ووسائل فتح الخزنة وعدم مشاركتها.</li>
        <li>التأكد من صحة بيانات الأوصياء والمستفيدين.</li>
        <li>تحديث إعدادات الطوارئ عند تغير ظروفك.</li>
      </ul>

      <h2>6. التخزين والتشفير</h2>
      <p>
        تُخزّن الخزنة العادية محليًا على جهاز المستخدم بشكل مشفّر. بعض ميزات
        الإرث الرقمي والطوارئ قد تتطلب نسخة مشفّرة للنقل وفق إعدادات المستخدم.
        فقدان وسيلة فتح الخزنة أو حذف البيانات المحلية قد يمنع استعادتها.
      </p>

      <h2>7. الاستخدام المقبول</h2>
      <p>
        يمنع استخدام الخدمة بطريقة غير قانونية أو لمحاولة الوصول إلى خزائن
        الآخرين أو تعطيل الخدمة أو إرسال تسجيلات آلية أو مضللة. نحتفظ بحق
        إيقاف إساءة الاستخدام أو حماية الخدمة عند الحاجة.
      </p>

      <h2>8. التغييرات والتواصل</h2>
      <p>
        قد تتغير الميزات أو الأسعار أو هذه الشروط مع تطور التطبيق. سننشر
        النسخة الأحدث هنا. للاستفسارات، تواصل معنا عبر{" "}
        <a href="mailto:myauryx@gmail.com">myauryx@gmail.com</a>.
      </p>
    </TermsLayout>
  )
}

function TermsLayout({ children }: { children: ReactNode }) {
  return <PrivacyLayout title="شروط الاستخدام" eyebrow="قبل الانضمام" children={children} />
}

function PrivacyLayout({ title, eyebrow, children }: {
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
              <span className="text-primary text-xl font-bold">A</span>
            </div>
            <span className="text-xl font-bold tracking-widest uppercase font-display text-white">AURYX</span>
          </Link>
          <Link href="/" className="text-sm text-white/60 hover:text-primary transition-colors">العودة للصفحة الرئيسية</Link>
        </div>
      </header>
      <main className="relative z-10 mx-auto max-w-3xl px-4 md:px-8 py-16 md:py-24">
        <div className="mb-10 text-center">
          <p className="text-sm font-bold text-primary mb-3">{eyebrow}</p>
          <h1 className="text-4xl md:text-5xl font-extrabold font-display text-white">{title}</h1>
        </div>
        <article className="glass-panel rounded-3xl border border-white/10 p-6 md:p-10 legal-content">{children}</article>
      </main>
    </div>
  )
}
import * as React from "react"
import { Link } from "wouter"
import { WaitlistForm } from "@/components/waitlist/WaitlistForm"
import { Shield, Lock, Share2, HeartPulse, KeyRound, ServerOff, CheckCircle2, ChevronDown, Mail, Phone } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

export function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 font-sans" dir="rtl">
      {/* Background Ambience */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-[40%] -right-[20%] w-[90%] h-[80%] rounded-full opacity-[0.18] blur-[120px] bg-[radial-gradient(circle_at_center,_#D4AF37_0%,_#8B6D1A_25%,_transparent_70%)] animate-pulse-gold"></div>
        <div className="absolute top-[30%] -left-[20%] w-[70%] h-[60%] rounded-full opacity-[0.08] blur-[130px] bg-[radial-gradient(circle_at_center,_#8B5CF6_0%,_transparent_60%)] animate-pulse-purple"></div>
        <div className="absolute bottom-0 right-0 w-full h-[60%] opacity-[0.04] bg-[radial-gradient(ellipse_at_bottom,_#D4AF37_0%,_transparent_60%)]"></div>
      </div>

      {/* Header */}
      <header className="relative z-20 border-b border-white/[0.06] backdrop-blur-xl bg-black/20">
        <div className="mx-auto max-w-7xl px-4 md:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Logo placeholder */}
            <div className="w-10 h-10 rounded bg-primary/10 flex items-center justify-center border border-primary/20 shadow-[0_0_15px_rgba(212,175,55,0.2)]">
              <Shield className="w-6 h-6 text-primary" />
            </div>
            <span className="text-xl font-bold tracking-widest uppercase font-display text-white">AURYX</span>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-white/60">
            <a href="#features" className="hover:text-primary transition-colors">المميزات</a>
            <a href="#pricing" className="hover:text-primary transition-colors">الأسعار</a>
            <a href="#faq" className="hover:text-primary transition-colors">الأسئلة الشائعة</a>
          </nav>
        </div>
      </header>

      <main className="relative z-10">
        {/* Hero Section */}
        <section className="mx-auto max-w-7xl px-4 md:px-8 pt-20 md:pt-32 pb-24 overflow-hidden flex flex-col lg:flex-row items-center gap-16 lg:gap-12">
          <div className="flex-1 text-center lg:text-right space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-xs font-bold tracking-wide text-primary">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
              إطلاق حصري قريبًا
            </div>
            
            <h1 className="text-5xl lg:text-7xl font-extrabold font-display leading-[1.1] tracking-tight">
              خزنتك الرقمية <br/>
              <span className="text-gradient">المشفرة. للأبد.</span>
            </h1>
            
            <p className="text-lg md:text-xl text-white/60 max-w-2xl mx-auto lg:mx-0 leading-relaxed">
              احفظ كلمات مرورك، ملفاتك، وأسرارك. شاركها بأمان تام، وانقلها لمن تثق بهم في حالات الطوارئ عبر بروتوكول الإرث الرقمي الخاص بنا.
            </p>

            <div className="glass-panel p-8 rounded-3xl max-w-md mx-auto lg:mx-0 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/0 via-primary to-primary/0"></div>
              <div className="mb-6 space-y-2">
                <h3 className="text-xl font-bold text-white">احصل على 50% خصم مدى الحياة!</h3>
                <p className="text-sm text-white/70 leading-relaxed">
                  أول 500 شخص يسجلون ويؤكدون بريدهم الإلكتروني سيحصلون على هذا الخصم الحصري عند الإطلاق.
                </p>
              </div>
              <WaitlistForm />
            </div>
          </div>

          <div className="flex-1 relative animate-in fade-in slide-in-from-left-8 duration-700 delay-200">
            <div className="relative w-full max-w-md mx-auto aspect-square flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border border-primary/20 animate-[spin_20s_linear_infinite]"></div>
              <div className="absolute inset-4 rounded-full border border-primary/10 animate-[spin_15s_linear_infinite_reverse]"></div>
              <div className="absolute inset-8 rounded-full border border-dashed border-primary/20 animate-[spin_30s_linear_infinite]"></div>
              <div className="w-40 h-40 rounded-full bg-background border border-primary/30 flex items-center justify-center shadow-[0_0_50px_rgba(212,175,55,0.2)] animate-float relative z-10">
                <Shield className="w-20 h-20 text-primary drop-shadow-[0_0_15px_rgba(212,175,55,0.8)]" />
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-24 border-y border-white/5 bg-black/40 relative">
          <div className="mx-auto max-w-7xl px-4 md:px-8">
            <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
              <h2 className="text-3xl md:text-4xl font-bold font-display text-white">أمان لا يقبل المساومة</h2>
              <p className="text-white/60">تم تصميم Auryx منذ اليوم الأول ليكون الحارس الأمين لأكثر بياناتك حساسية، معتمدًا على أحدث بروتوكولات التشفير العسكري.</p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              <FeatureCard 
                icon={<Lock />}
                title="تشفير عسكري من طرف إلى طرف"
                description="بياناتك تشفر على جهازك قبل أن تصل إلينا. نحن لا نملك مفتاحك، ولا يمكن لأي جهة أخرى الاطلاع على محتويات خزنتك."
              />
              <FeatureCard 
                icon={<HeartPulse />}
                title="بروتوكول الطوارئ والغياب"
                description="في حال الطوارئ أو غيابك لفترة طويلة، يقوم النظام تلقائياً بنقل خزنتك إلى المستفيدين الذين حددتهم مسبقاً بشكل مشفر وآمن."
              />
              <FeatureCard 
                icon={<Share2 />}
                title="مشاركة آمنة ومحدودة"
                description="شارك كلمات المرور والملاحظات السرية مع من تريد بضغطة زر، مع إمكانية تحديد صلاحيات ومدة زمنية للوصول."
              />
              <FeatureCard 
                icon={<KeyRound />}
                title="أنت المالك الوحيد"
                description="نظام التشفير يعتمد على بنية المعرفة الصفرية (Zero-Knowledge). إذا فقدت مفتاحك، لا يمكننا استرجاع بياناتك."
              />
              <FeatureCard 
                icon={<ServerOff />}
                title="لا حاجة للاتصال الدائم"
                description="تصفح بياناتك وخزنتك بدون إنترنت. يتم المزامنة بشكل آمن ومجزء فور اتصالك بالشبكة."
              />
              <FeatureCard 
                icon={<Shield />}
                title="الإرث الرقمي المحمي"
                description="احمِ عائلتك وأحباءك من فقدان الوصول للأصول الرقمية الهامة، وورثهم بياناتك بطريقة تضمن الخصوصية التامة."
              />
            </div>
          </div>
        </section>

        {/* Pricing Teaser */}
        <section id="pricing" className="py-24 relative overflow-hidden">
          <div className="mx-auto max-w-5xl px-4 md:px-8 text-center space-y-12 relative z-10">
            <div className="space-y-4">
              <h2 className="text-3xl md:text-5xl font-bold font-display">استثمر في أمانك</h2>
              <p className="text-lg text-white/60 max-w-2xl mx-auto">
                تسعير شفاف وبسيط. انضم لقائمة الانتظار الآن لتفعيل خصم 50% مدى الحياة فور الإطلاق.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
              <div className="glass-panel p-8 rounded-3xl border border-white/5 flex flex-col">
                <h3 className="text-xl font-bold text-white mb-2">الخطة الشهرية</h3>
                <div className="flex items-end justify-center gap-2 mb-6">
                  <span className="text-4xl font-bold text-white">$5.99</span>
                  <span className="text-white/50 mb-1">/ شهر</span>
                </div>
                <div className="bg-primary/10 text-primary py-2 px-4 rounded-xl text-sm font-bold mb-8">
                  سيكون $2.99 فقط إذا كنت من أول 500!
                </div>
                <ul className="space-y-3 text-sm text-white/70 text-right mb-8 flex-1">
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary shrink-0"/> تشفير عسكري كامل</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary shrink-0"/> إضافة مستفيدين لطوارئ</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary shrink-0"/> مشاركة غير محدودة</li>
                </ul>
              </div>

              <div className="glass-panel p-8 rounded-3xl border border-primary/30 relative flex flex-col shadow-[0_0_30px_rgba(212,175,55,0.1)]">
                <div className="absolute top-0 right-1/2 translate-x-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-4 py-1 rounded-full text-xs font-bold">
                  الأكثر توفيراً
                </div>
                <h3 className="text-xl font-bold text-white mb-2">الخطة السنوية</h3>
                <div className="flex items-end justify-center gap-2 mb-6">
                  <span className="text-4xl font-bold text-primary">$45.99</span>
                  <span className="text-white/50 mb-1">/ سنة</span>
                </div>
                <div className="bg-primary/10 text-primary py-2 px-4 rounded-xl text-sm font-bold mb-8">
                  سيكون $22.99 فقط إذا كنت من أول 500!
                </div>
                <ul className="space-y-3 text-sm text-white/70 text-right mb-8 flex-1">
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary shrink-0"/> جميع ميزات الخطة الشهرية</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary shrink-0"/> توفير شهرين مجاناً</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary shrink-0"/> دعم فني على مدار الساعة</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="py-24 border-t border-white/5 bg-black/40">
          <div className="mx-auto max-w-3xl px-4 md:px-8">
            <div className="text-center mb-12 space-y-4">
              <h2 className="text-3xl md:text-4xl font-bold font-display text-white">الأسئلة الشائعة</h2>
              <p className="text-white/60">كل ما تحتاج معرفته عن Auryx وأمان بياناتك.</p>
            </div>

            <Accordion type="single" collapsible className="w-full text-right" dir="rtl">
              <AccordionItem value="item-1" className="border-white/10">
                <AccordionTrigger className="text-right text-lg hover:text-primary hover:no-underline">هل يمكن لفريق Auryx رؤية ملفاتي؟</AccordionTrigger>
                <AccordionContent className="text-white/60 leading-relaxed text-base">
                  مستحيل نهائياً. نحن نستخدم نظام التشفير من طرف إلى طرف (E2EE). ملفاتك تتشفر على جهازك والمفتاح يبقى معك وحدك، ولا نملك أي طريقة لفك تشفيرها.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2" className="border-white/10">
                <AccordionTrigger className="text-right text-lg hover:text-primary hover:no-underline">هل التطبيق مجاني؟</AccordionTrigger>
                <AccordionContent className="text-white/60 leading-relaxed text-base">
                  Auryx يأتي بخطط مدفوعة لضمان استمرارية الجودة العالية والأمان، ولكن المسجلين في قائمة الانتظار الآن سيحصلون على خصم 50% مدى الحياة (للـ 500 مستخدم الأوائل). السعر الأساسي 5.99$ شهرياً و 45.99$ سنوياً.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-3" className="border-white/10">
                <AccordionTrigger className="text-right text-lg hover:text-primary hover:no-underline">ماذا لو فقدت هاتفي أو تعرضت لظرف طارئ؟</AccordionTrigger>
                <AccordionContent className="text-white/60 leading-relaxed text-base">
                  لا داعي للقلق. إذا فعّلت بروتوكولات الطوارئ والغياب، سيتم تفعيل البروتوكول ونقل خزنتك بشكل مشفر بالكامل لهاتف المستفيد الذي حددته مسبقاً، بعد تطبيق جميع الشروط الأمنية التي وضعتها.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-4" className="border-white/10">
                <AccordionTrigger className="text-right text-lg hover:text-primary hover:no-underline">هل يحتاج التطبيق للانترنت؟</AccordionTrigger>
                <AccordionContent className="text-white/60 leading-relaxed text-base">
                  نعم، يحتاج للانترنت لنقل الخزنة والمزامنة، وتفعيل ميزات الإرث الرقمي. لكن التصفح داخل خزنتك يعمل بشكل عادي بدون إنترنت بفضل التخزين المحلي المشفر.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 bg-[#050507] pt-16 pb-8">
        <div className="mx-auto max-w-7xl px-4 md:px-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center border border-primary/20">
              <Shield className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm font-bold tracking-widest uppercase font-display text-white">AURYX &copy; 2026</span>
          </div>

          <div className="flex flex-col md:flex-row items-center gap-6 text-sm text-white/50">
            <div className="flex items-center gap-5">
              <Link href="/privacy" className="hover:text-primary transition-colors">سياسة الخصوصية</Link>
              <Link href="/terms" className="hover:text-primary transition-colors">شروط الاستخدام</Link>
            </div>
            <span className="hidden md:block w-1 h-1 rounded-full bg-white/20"></span>
            <a href="mailto:myauryx@gmail.com" className="flex items-center gap-2 hover:text-primary transition-colors">
              <Mail className="w-4 h-4" />
              myauryx@gmail.com
            </a>
            <span className="hidden md:block w-1 h-1 rounded-full bg-white/20"></span>
            <a href="tel:+962793310321" dir="ltr" className="flex items-center gap-2 hover:text-primary transition-colors">
              <Phone className="w-4 h-4" />
              +962 79 331 0321
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="glass-panel p-6 rounded-2xl border border-white/5 hover:border-primary/30 transition-colors group">
      <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-6 group-hover:scale-110 transition-transform group-hover:bg-primary/20">
        {icon}
      </div>
      <h3 className="text-xl font-bold text-white mb-3">{title}</h3>
      <p className="text-white/60 text-sm leading-relaxed">{description}</p>
    </div>
  )
}

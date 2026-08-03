import * as React from "react"
import { Link } from "wouter"
import { WaitlistForm } from "@/components/waitlist/WaitlistForm"
import { Shield, Lock, KeyRound, ServerOff, Check, HardDrive, Smartphone, ShieldCheck, FileKey2, EyeOff, Mail, Phone } from "lucide-react"
import { cn } from "@/lib/utils"
import { landingLocales, type Language } from "@/lib/i18n"

const asset = (name: string) => `${import.meta.env.BASE_URL}assets/${name}`
const auryxLogo = asset("auryx-logo.png")
const appLock = asset("app-lock.jpg")
const appHome = asset("app-home.jpg")
const appSettings = asset("app-settings.jpg")
const appGuardians = asset("app-guardians.jpg")

export function Landing() {
  const [lang, setLang] = React.useState<Language>('ar')
  const t = landingLocales[lang]

  return (
    <div className={cn(
      "min-h-[100dvh] bg-background text-foreground selection:bg-primary/30",
      lang === 'ar' ? "font-sans-ar" : "font-sans-en"
    )} dir={t.dir}>
      {/* Background Ambience */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0 bg-[#0a0a0c]">
        <div className="absolute top-[-20%] right-[-10%] w-[80%] h-[70%] rounded-full opacity-[0.15] blur-[150px] bg-[radial-gradient(circle_at_center,_#D4AF37_0%,_transparent_70%)] animate-pulse-gold"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full opacity-[0.15] blur-[130px] bg-[radial-gradient(circle_at_center,_#8B5CF6_0%,_transparent_70%)] animate-pulse-purple"></div>
      </div>

      {/* Header */}
      <header className="relative z-20 border-b border-white/5 backdrop-blur-2xl bg-black/40 sticky top-0">
        <div className="mx-auto max-w-7xl px-4 md:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 flex items-center justify-center">
              <img src={auryxLogo} alt="Auryx Logo" className="w-full h-full object-contain" />
            </div>
            <span className={cn("text-xl font-bold tracking-widest uppercase text-white", lang === 'ar' ? 'font-display-ar' : 'font-display-en')}>AURYX</span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-white/60">
            <a href="#features" className="hover:text-primary transition-colors">{t.nav.features}</a>
            <a href="#screens" className="hover:text-primary transition-colors">{t.nav.screens}</a>
            <a href="#inheritance" className="hover:text-primary transition-colors">{t.nav.inheritance}</a>
            <a href="#security" className="hover:text-primary transition-colors">{t.nav.security}</a>
            <a href="#compare" className="hover:text-primary transition-colors">{t.nav.compare}</a>
          </nav>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
              className="text-xs font-bold text-white/70 hover:text-white px-3 py-1.5 rounded-full border border-white/10 bg-white/5 transition-colors"
            >
              {lang === 'ar' ? 'English' : 'العربية'}
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* Hero Section */}
        <section className="mx-auto max-w-7xl px-4 md:px-8 pt-20 md:pt-32 pb-24 overflow-hidden flex flex-col lg:flex-row items-center gap-16 lg:gap-12">
          <div className={cn("flex-1 space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700", lang === 'ar' ? "text-right" : "text-left")}>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-xs font-bold tracking-wide text-primary">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
              {t.hero.badge}
            </div>
            
            <h1 className={cn("text-5xl lg:text-7xl font-extrabold leading-[1.1] tracking-tight text-white", lang === 'ar' ? 'font-display-ar' : 'font-display-en')}>
              {t.hero.title}
            </h1>
            
            <p className="text-lg md:text-xl text-white/60 max-w-2xl leading-relaxed">
              {t.hero.subtitle}
            </p>

            <div className="glass-panel p-8 rounded-3xl max-w-md relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/0 via-primary to-primary/0"></div>
              <div className="mb-6 space-y-2">
                <h3 className="text-xl font-bold text-white">{t.hero.discountTitle}</h3>
                <p className="text-sm text-white/70 leading-relaxed">
                  {t.hero.discountDesc}
                </p>
              </div>
              <WaitlistForm lang={lang} />
            </div>
          </div>

          <div className="flex-1 relative w-full flex justify-center animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-200 lg:h-[600px] h-[400px]">
            <div className="relative w-full max-w-md">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-primary/20 blur-[100px] rounded-full mix-blend-screen animate-pulse-gold" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-purple-500/20 blur-[80px] rounded-full mix-blend-screen animate-pulse-purple" />

              <div className="hero-logo-orb absolute top-[13%] left-1/2 -translate-x-1/2 w-44 h-44 rounded-full border border-primary/30 bg-[#0e0e13]/85 shadow-[0_0_70px_rgba(212,175,55,0.26)] animate-float z-30">
                <div className="absolute inset-3 rounded-full border border-primary/15 bg-primary/[0.04]" />
                <img
                  src={auryxLogo}
                  alt="Auryx Logo"
                  className="absolute inset-7 w-[calc(100%-3.5rem)] h-[calc(100%-3.5rem)] object-contain drop-shadow-[0_0_30px_rgba(212,175,55,0.45)]"
                />
              </div>

              <div className="absolute top-[10%] left-[5%] w-[160px] md:w-[200px] -rotate-12 opacity-40 blur-[2px] transition-transform hover:opacity-100 hover:blur-none hover:z-40 duration-500">
                 <PhoneMockup src={appLock} alt="Auryx Lock Screen" />
              </div>

              <div className="absolute top-[20%] right-[0%] w-[180px] md:w-[240px] rotate-6 shadow-2xl z-20 transition-transform hover:-translate-y-4 duration-500">
                 <PhoneMockup src={appHome} alt="Auryx Home Screen" />
              </div>

              <div className="absolute top-[35%] left-[0%] w-[140px] md:w-[180px] -rotate-6 opacity-60 blur-[1px] transition-transform hover:opacity-100 hover:blur-none hover:z-40 duration-500 z-10">
                 <PhoneMockup src={appSettings} alt="Auryx Settings Screen" />
              </div>
            </div>
          </div>
        </section>

        {/* App Screenshots */}
        <section id="screens" className="py-24 border-y border-white/5 bg-black/30 relative overflow-hidden">
          <div className="mx-auto max-w-7xl px-4 md:px-8">
            <div className="text-center max-w-3xl mx-auto mb-14 space-y-4">
              <p className="text-sm font-bold tracking-[0.18em] uppercase text-primary">{t.screens.eyebrow}</p>
              <h2 className={cn("text-3xl md:text-5xl font-bold text-white", lang === 'ar' ? 'font-display-ar' : 'font-display-en')}>{t.screens.title}</h2>
              <p className="text-lg text-white/60">{t.screens.subtitle}</p>
            </div>

            <div className="screenshots-row">
              <PhoneMockup src={appLock} alt={t.screens.alts.lock} className="screenshot-phone screenshot-phone-1" />
              <PhoneMockup src={appHome} alt={t.screens.alts.home} className="screenshot-phone screenshot-phone-2" />
              <PhoneMockup src={appGuardians} alt={t.screens.alts.guardians} className="screenshot-phone screenshot-phone-3" />
              <PhoneMockup src={appSettings} alt={t.screens.alts.settings} className="screenshot-phone screenshot-phone-4" />
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-24 border-y border-white/5 bg-black/20 relative">
          <div className="mx-auto max-w-7xl px-4 md:px-8">
            <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
              <h2 className={cn("text-3xl md:text-5xl font-bold text-white", lang === 'ar' ? 'font-display-ar' : 'font-display-en')}>{t.features.title}</h2>
              <p className="text-lg text-white/60">{t.features.subtitle}</p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <FeatureCard 
                icon={<Lock />}
                title={t.features.e2ee.title}
                description={t.features.e2ee.desc}
              />
              <FeatureCard 
                icon={<EyeOff />}
                title={t.features.zeroKnowledge.title}
                description={t.features.zeroKnowledge.desc}
              />
              <FeatureCard 
                icon={<HardDrive />}
                title={t.features.storage.title}
                description={t.features.storage.desc}
              />
              <FeatureCard 
                icon={<ShieldCheck />}
                title={t.features.twoFactor.title}
                description={t.features.twoFactor.desc}
              />
            </div>
          </div>
        </section>

        {/* Inheritance Deep Dive */}
        <section id="inheritance" className="py-24 relative overflow-hidden">
          <div className="mx-auto max-w-7xl px-4 md:px-8 flex flex-col lg:flex-row items-center gap-16">
            <div className="flex-1 relative w-full max-w-md mx-auto">
              <div className="absolute inset-0 bg-purple-500/10 blur-[100px] rounded-full"></div>
              <PhoneMockup src={appGuardians} alt="Digital Inheritance" className="z-10 relative" />
            </div>

            <div className={cn("flex-1 space-y-12", lang === 'ar' ? 'text-right' : 'text-left')}>
              <div className="space-y-4">
                <h2 className={cn("text-3xl md:text-5xl font-bold text-white", lang === 'ar' ? 'font-display-ar' : 'font-display-en')}>{t.inheritance.title}</h2>
                <p className="text-lg text-white/60">{t.inheritance.subtitle}</p>
              </div>

              <div className="space-y-8 relative before:absolute before:inset-y-2 before:w-px before:bg-white/10 before:right-6 rtl:before:right-6 ltr:before:left-6 ltr:before:right-auto">
                <Step
                  number="1"
                  title={t.inheritance.step1.title}
                  desc={t.inheritance.step1.desc}
                  lang={lang}
                />
                <Step
                  number="2"
                  title={t.inheritance.step2.title}
                  desc={t.inheritance.step2.desc}
                  lang={lang}
                />
                <Step
                  number="3"
                  title={t.inheritance.step3.title}
                  desc={t.inheritance.step3.desc}
                  lang={lang}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Security & Trust */}
        <section id="security" className="py-24 border-y border-white/5 bg-black/40 relative">
          <div className="mx-auto max-w-7xl px-4 md:px-8">
            <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
              <h2 className={cn("text-3xl md:text-5xl font-bold text-white", lang === 'ar' ? 'font-display-ar' : 'font-display-en')}>{t.security.title}</h2>
              <p className="text-lg text-white/60">{t.security.subtitle}</p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              <TrustCard icon={<FileKey2 />} title={t.security.sourceCode.title} desc={t.security.sourceCode.desc} />
              <TrustCard icon={<Shield />} title={t.security.audit.title} desc={t.security.audit.desc} />
              <TrustCard icon={<KeyRound />} title={t.security.recovery.title} desc={t.security.recovery.desc} />
              <TrustCard icon={<ServerOff />} title={t.security.privacy.title} desc={t.security.privacy.desc} />
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-24 relative overflow-hidden">
          <div className="mx-auto max-w-5xl px-4 md:px-8">
            <div className="text-center max-w-3xl mx-auto mb-14 space-y-4">
              <p className="text-sm font-bold tracking-[0.18em] uppercase text-primary">{t.pricing.eyebrow}</p>
              <h2 className={cn("text-3xl md:text-5xl font-bold text-white", lang === 'ar' ? 'font-display-ar' : 'font-display-en')}>{t.pricing.title}</h2>
              <p className="text-lg text-white/60">{t.pricing.subtitle}</p>
            </div>

            <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
              <PricingCard
                title={t.pricing.monthly.title}
                price={t.pricing.monthly.price}
                period={t.pricing.monthly.period}
                discount={t.pricing.monthly.discount}
                features={t.pricing.monthly.features}
              />
              <PricingCard
                title={t.pricing.annual.title}
                price={t.pricing.annual.price}
                period={t.pricing.annual.period}
                discount={t.pricing.annual.discount}
                features={t.pricing.annual.features}
                featured
              />
            </div>
            <p className="text-xs text-white/40 text-center mt-6">{t.pricing.note}</p>
          </div>
        </section>

        {/* Compare Table */}
        <section id="compare" className="py-24 relative overflow-hidden">
          <div className="mx-auto max-w-5xl px-4 md:px-8">
            <div className="text-center mb-16 space-y-4">
              <h2 className={cn("text-3xl md:text-5xl font-bold text-white", lang === 'ar' ? 'font-display-ar' : 'font-display-en')}>{t.compare.title}</h2>
              <p className="text-lg text-white/60">{t.compare.subtitle}</p>
            </div>

            <div className="glass-panel rounded-3xl overflow-hidden border border-white/5">
              <div className="overflow-x-auto">
                <table className="w-full text-sm lg:text-base" dir={t.dir}>
                  <thead>
                    <tr className="border-b border-white/5 bg-black/40">
                      <th className={cn("p-6 font-bold text-white/70", lang === 'ar' ? 'text-right' : 'text-left')}>{t.compare.feature}</th>
                      <th className="p-6 font-bold text-primary text-center bg-primary/5">{t.compare.auryx}</th>
                      <th className="p-6 font-bold text-white/50 text-center">1Password</th>
                      <th className="p-6 font-bold text-white/50 text-center">Bitwarden</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {t.compare.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                        <td className="p-6 text-white/80 font-medium">{row.name}</td>
                        <td className="p-6 text-center font-bold text-primary bg-primary/[0.02]">
                          <div className="flex flex-col items-center justify-center gap-2">
                            {row.a === 'نعم' || row.a === 'Yes' ? <Check className="w-5 h-5 text-primary" /> : null}
                            <span>{row.a}</span>
                          </div>
                        </td>
                        <td className="p-6 text-center text-white/50">{row.b}</td>
                        <td className="p-6 text-center text-white/50">{row.c}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-xs text-white/40 text-center mt-6">{t.compare.disclaimer}</p>
          </div>
        </section>

        {/* Community & Team */}
        <section className="py-24 relative overflow-hidden">
           <div className="mx-auto max-w-4xl px-4 md:px-8 text-center space-y-6 relative z-10">
            <h2 className={cn("text-2xl md:text-3xl font-bold text-white", lang === 'ar' ? 'font-display-ar' : 'font-display-en')}>{t.community.title}</h2>
            <p className="text-white/60">{t.community.desc}</p>
             <div className="trust-placeholders grid sm:grid-cols-3 gap-3 pt-4">
               {t.community.signals.map((signal) => (
                 <div key={signal} className="rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-4 text-sm text-white/55">
                   {signal}
                 </div>
               ))}
             </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer id="footer" className="relative z-20 isolate border-t border-white/5 bg-black pt-16 pb-8 scroll-mt-20">
        <div className="mx-auto max-w-7xl px-4 md:px-8 space-y-12">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded flex items-center justify-center">
                <img src={auryxLogo} alt="Auryx" className="w-6 h-6 object-contain" />
              </div>
              <span className={cn("text-sm font-bold tracking-widest uppercase text-white", lang === 'ar' ? 'font-display-ar' : 'font-display-en')}>AURYX</span>
            </div>

            <div className="flex items-center gap-4 text-white/60">
               <Smartphone className="w-5 h-5" />
               <span className="text-sm">{t.platforms}</span>
            </div>
          </div>

          <div className="grid gap-8 border-t border-white/5 pt-8 text-sm text-white/50 md:grid-cols-[1fr_auto_auto] md:items-end">
            <div className={cn("flex flex-col gap-2", lang === 'ar' ? "text-right" : "text-left")}>
              <p className="text-base font-bold text-white">&copy; 2026 Auryx. {t.footer.rights}</p>
              <p>{t.footer.team}</p>
            </div>

            <div className="flex flex-col items-center gap-3 md:items-start">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">{t.footer.contactTitle}</p>
              <a href="mailto:myauryx@gmail.com" className="flex items-center gap-2 hover:text-primary transition-colors">
                <Mail className="h-4 w-4 text-primary" />
                <span dir="ltr">myauryx@gmail.com</span>
              </a>
              <a href="tel:+962793310321" className="flex items-center gap-2 hover:text-primary transition-colors">
                <Phone className="h-4 w-4 text-primary" />
                <span dir="ltr">+962 79 331 0321</span>
              </a>
            </div>

            <div className="flex items-center justify-center gap-6 md:justify-end">
              <Link href="/privacy" className="hover:text-primary transition-colors">{t.footer.links.privacy}</Link>
              <Link href="/terms" className="hover:text-primary transition-colors">{t.footer.links.terms}</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

function PhoneMockup({ src, alt, className }: { src: string, alt: string, className?: string }) {
  return (
    <div className={cn("relative rounded-[2.5rem] md:rounded-[3rem] border-[6px] md:border-[8px] border-[#111] bg-black shadow-2xl overflow-hidden aspect-[9/19.5]", className)}>
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/3 h-5 md:h-7 bg-[#111] rounded-b-xl md:rounded-b-2xl z-20" />
      <img src={src} alt={alt} className="w-full h-full object-cover relative z-10" />
      <div className="absolute inset-0 ring-1 ring-white/10 rounded-[2.2rem] md:rounded-[2.7rem] z-30 pointer-events-none" />
    </div>
  )
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="glass-panel p-8 rounded-3xl border border-white/5 hover:border-primary/30 transition-all duration-300 group">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-6 group-hover:scale-110 transition-transform group-hover:bg-primary/20">
        {icon}
      </div>
      <h3 className="text-xl font-bold text-white mb-3">{title}</h3>
      <p className="text-white/60 text-sm md:text-base leading-relaxed">{description}</p>
    </div>
  )
}

function TrustCard({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) {
  return (
    <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors">
      <div className="text-white/40 mb-4">{icon}</div>
      <h4 className="text-lg font-bold text-white mb-2">{title}</h4>
      <p className="text-sm text-white/50 leading-relaxed">{desc}</p>
    </div>
  )
}

function PricingCard({
  title,
  price,
  period,
  discount,
  features,
  featured = false,
}: {
  title: string
  price: string
  period: string
  discount: string
  features: string[]
  featured?: boolean
}) {
  return (
    <div className={cn(
      "glass-panel rounded-3xl p-8 border flex flex-col",
      featured ? "border-primary/35 shadow-[0_0_35px_rgba(212,175,55,0.12)]" : "border-white/5"
    )}>
      {featured && (
        <span className="self-start rounded-full bg-primary/15 px-3 py-1 text-xs font-bold text-primary mb-5">
          الأكثر توفيراً
        </span>
      )}
      <h3 className="text-xl font-bold text-white">{title}</h3>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-4xl font-bold text-white">{price}</span>
        <span className="text-sm text-white/45">{period}</span>
      </div>
      <p className="mt-5 rounded-xl bg-primary/10 px-4 py-3 text-sm font-bold text-primary">{discount}</p>
      <ul className="mt-6 space-y-3 text-sm text-white/65">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Step({ number, title, desc, lang }: { number: string, title: string, desc: string, lang: Language }) {
  return (
    <div className="relative z-10 flex gap-6">
      <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold shrink-0">
        {number}
      </div>
      <div>
        <h4 className="text-xl font-bold text-white mb-2">{title}</h4>
        <p className="text-white/60 leading-relaxed">{desc}</p>
      </div>
    </div>
  )
}

import * as React from "react"
import { useParams, Link } from "wouter"
import { useConfirmWaitlistEmail, getConfirmWaitlistEmailQueryKey } from "@workspace/api-client-react"
import { Shield, CheckCircle2, XCircle, Loader2 } from "lucide-react"

export function Confirm() {
  const params = useParams<{ token: string }>()
  const token = params?.token || ""

  const { data, isLoading, isError, error } = useConfirmWaitlistEmail(token, {
    query: {
      queryKey: getConfirmWaitlistEmailQueryKey(token),
      enabled: !!token,
      retry: false
    }
  })

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 font-sans" dir="rtl">
      {/* Background Ambience */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-[40%] -right-[20%] w-[90%] h-[80%] rounded-full opacity-[0.18] blur-[120px] bg-[radial-gradient(circle_at_center,_#D4AF37_0%,_transparent_70%)]"></div>
        <div className="absolute bottom-0 right-0 w-full h-[60%] opacity-[0.04] bg-[radial-gradient(ellipse_at_bottom,_#8B5CF6_0%,_transparent_60%)]"></div>
      </div>

      <div className="glass-panel p-8 md:p-12 rounded-3xl max-w-md w-full border border-white/10 relative z-10 text-center animate-in fade-in zoom-in duration-500">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-[0_0_20px_rgba(212,175,55,0.2)] mx-auto mb-8">
          <Shield className="w-8 h-8 text-primary" />
        </div>

        {isLoading && (
          <div className="space-y-4">
            <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto" />
            <h2 className="text-2xl font-bold font-display text-white">جاري التأكيد...</h2>
            <p className="text-white/60">نرجو الانتظار بينما نقوم بتأكيد بريدك الإلكتروني.</p>
          </div>
        )}

        {isError && (
          <div className="space-y-4">
            <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-2xl font-bold font-display text-white">حدث خطأ</h2>
            <p className="text-white/60 leading-relaxed">
              لم نتمكن من تأكيد بريدك الإلكتروني. قد يكون الرابط منتهي الصلاحية أو غير صالح.
            </p>
            <Link href="/" className="mt-6 w-full h-12 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-white font-medium hover:bg-white/10 transition-colors">
              العودة للصفحة الرئيسية
            </Link>
          </div>
        )}

        {data && (
          <div className="space-y-4">
            <CheckCircle2 className="w-12 h-12 text-primary mx-auto mb-4 shadow-[0_0_20px_rgba(212,175,55,0.3)] rounded-full" />
            <h2 className="text-2xl font-bold font-display text-white">تم التأكيد بنجاح!</h2>
            <p className="text-white/60 leading-relaxed">
              شكراً لك. لقد تم تأكيد بريدك الإلكتروني. ستكون من أوائل الذين يحصلون على الخصم عند انطلاق Auryx.
            </p>
            <Link href="/" className="mt-6 w-full h-12 flex items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold hover:bg-primary/90 transition-colors shadow-[0_0_20px_rgba(212,175,55,0.2)] hover:shadow-[0_0_30px_rgba(212,175,55,0.4)]">
              العودة للصفحة الرئيسية
            </Link>
          </div>
        )}

        {!token && !isLoading && !isError && !data && (
          <div className="space-y-4">
            <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-2xl font-bold font-display text-white">رابط مفقود</h2>
            <p className="text-white/60">
              الرابط الذي تحاول الوصول إليه غير كامل.
            </p>
            <Link href="/" className="mt-6 w-full h-12 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-white font-medium hover:bg-white/10 transition-colors">
              العودة للصفحة الرئيسية
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

import * as React from "react"
import { useGetMyWaitlistEligibility, getGetMyWaitlistEligibilityQueryKey } from "@workspace/api-client-react"
import { cn } from "@/lib/utils"

export function WaitlistEligibilityStatus({ className }: { className?: string }) {
  const { data: eligibility, isError, isLoading } = useGetMyWaitlistEligibility({
    query: {
      queryKey: getGetMyWaitlistEligibilityQueryKey(),
      retry: false, // Don't retry on 401
    }
  })

  if (isLoading || isError || !eligibility) {
    return null
  }

  if (eligibility.confirmed && eligibility.eligible) {
    return (
      <div className={cn("w-full bg-primary/10 border-b border-primary/20 text-primary py-2 px-4 text-center text-sm font-medium", className)}>
        مرحباً بعودتك! حسابك مؤكد وأنت ضمن أول 500 مستخدم. ستحصل على الخصم (50%) عند الإطلاق.
      </div>
    )
  }

  if (eligibility.confirmed && !eligibility.eligible) {
    return (
      <div className={cn("w-full bg-white/5 border-b border-white/10 text-white/70 py-2 px-4 text-center text-sm font-medium", className)}>
        بريدك مؤكد! شكراً لاهتمامك بـ Auryx.
      </div>
    )
  }

  return (
    <div className={cn("w-full bg-secondary text-secondary-foreground py-2 px-4 text-center text-sm font-medium", className)}>
      لقد قمت بالتسجيل ولكن لم يتم تأكيد بريدك بعد. الرجاء التحقق من بريدك الإلكتروني.
    </div>
  )
}

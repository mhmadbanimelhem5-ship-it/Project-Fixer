import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import {
  getGetWaitlistStatsQueryKey,
  useGetWaitlistStats,
  useRegisterWaitlist,
} from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Loader2 } from "lucide-react"
import { Link } from "wouter"
import { waitlistLocales } from "@/lib/i18n"

export function WaitlistForm({ lang = 'ar' }: { lang?: 'ar' | 'en' }) {
  const t = waitlistLocales[lang]
  const [success, setSuccess] = React.useState(false)
  const [alreadyConfirmed, setAlreadyConfirmed] = React.useState(false)

  const formSchema = z.object({
    email: z.string().email({ message: t.emailInvalid }),
    privacyAccepted: z.boolean().refine((val) => val === true, {
      message: t.privacyRequired,
    }),
  })

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      privacyAccepted: false,
    },
  })

  const { mutate: register, isPending } = useRegisterWaitlist()
  const { data: stats } = useGetWaitlistStats({
    query: {
      queryKey: getGetWaitlistStatsQueryKey(),
      refetchInterval: 15000,
      staleTime: 10000,
      retry: 2,
    },
  })

  function onSubmit(values: z.infer<typeof formSchema>) {
    register(
      { data: { email: values.email, privacyAccepted: true } },
      {
        onSuccess: (res) => {
          if (res.alreadyConfirmed) {
            setAlreadyConfirmed(true)
          } else {
            setSuccess(true)
          }
        },
        onError: (err) => {
          form.setError("root", {
            type: "server",
            message: t.errorGeneric,
          })
        },
      }
    )
  }

  if (alreadyConfirmed) {
    return (
      <div className="glass-panel p-6 rounded-2xl border border-primary/20 text-center animate-in fade-in zoom-in duration-500">
        <h3 className="text-xl font-bold text-primary mb-2">{t.alreadyConfirmedTitle}</h3>
        <p className="text-muted-foreground text-sm">
          {t.alreadyConfirmedDesc}
        </p>
      </div>
    )
  }

  if (success) {
    return (
      <div className="glass-panel p-6 rounded-2xl border border-primary/20 text-center animate-in fade-in zoom-in duration-500">
        <h3 className="text-xl font-bold text-primary mb-2">{t.successTitle}</h3>
        <p className="text-muted-foreground text-sm mb-4">
          {t.successDesc}
        </p>
        <p className="text-xs text-white/50">
          {t.successNote}
        </p>
      </div>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="sr-only">Email</FormLabel>
              <FormControl>
                <Input 
                  placeholder={t.emailPlaceholder}
                  className="h-14 bg-black/40 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-primary text-base px-5 rounded-xl"
                  {...field} 
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="privacyAccepted"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-x-reverse space-y-0 p-1">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  className="mt-1 border-white/20 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                />
              </FormControl>
              <div className="space-y-1 leading-relaxed">
                <FormLabel className="text-sm font-medium text-white/70 cursor-pointer">
                  {t.privacyPrefix} <Link href="/privacy" className="text-primary underline underline-offset-4 hover:text-primary/80">{t.privacyLink}</Link>
                  {t.and}<Link href="/terms" className="text-primary underline underline-offset-4 hover:text-primary/80">{t.termsLink}</Link>{t.privacySuffix}
                </FormLabel>
              </div>
            </FormItem>
          )}
        />

        {form.formState.errors.root && (
          <p className="text-[0.8rem] font-medium text-destructive">
            {form.formState.errors.root.message}
          </p>
        )}

        {stats ? (
          <div
            className="rounded-2xl border border-primary/20 bg-primary/[0.07] px-4 py-3 text-center"
            aria-live="polite"
          >
            {stats.discountSpotsRemaining > 0 ? (
              <>
                <p className="text-sm font-bold text-primary">
                  {t.statsTitle}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-white/65">
                  {t.statsDescPrefix}{stats.discountLimit}{t.statsDescSuffix}
                </p>
                <div className="mt-3 flex items-center justify-center gap-3 text-xs font-bold">
                  <span className="text-white">
                    {stats.confirmedCount.toLocaleString("en-US")} {t.confirmed}
                  </span>
                  <span className="h-1 w-1 rounded-full bg-primary/60" />
                  <span className="text-primary">
                    {stats.discountSpotsRemaining.toLocaleString("en-US")} {t.spotsRemaining}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm font-bold text-primary">
                {t.offerFullPrefix}{stats.discountLimit}{t.offerFullSuffix}
              </p>
            )}
          </div>
        ) : null}

        <Button
          type="submit" 
          disabled={isPending}
          className="w-full h-14 rounded-xl text-base font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_20px_rgba(212,175,55,0.3)] transition-all hover:shadow-[0_0_30px_rgba(212,175,55,0.5)]"
        >
          {isPending ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            t.btnSubmit
          )}
        </Button>
      </form>
    </Form>
  )
}

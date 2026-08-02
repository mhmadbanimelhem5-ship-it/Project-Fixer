import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useRegisterWaitlist } from "@workspace/api-client-react"
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

const formSchema = z.object({
  email: z.string().email({ message: "الرجاء إدخال بريد إلكتروني صحيح" }),
  privacyAccepted: z.boolean().refine((val) => val === true, {
    message: "يجب الموافقة على سياسة الخصوصية",
  }),
})

export function WaitlistForm() {
  const [success, setSuccess] = React.useState(false)
  const [alreadyConfirmed, setAlreadyConfirmed] = React.useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      privacyAccepted: false,
    },
  })

  const { mutate: register, isPending } = useRegisterWaitlist()

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
            message: "حدث خطأ غير متوقع. حاول مرة أخرى.",
          })
        },
      }
    )
  }

  if (alreadyConfirmed) {
    return (
      <div className="glass-panel p-6 rounded-2xl border border-primary/20 text-center animate-in fade-in zoom-in duration-500">
        <h3 className="text-xl font-bold text-primary mb-2">أنت مسجل بالفعل!</h3>
        <p className="text-muted-foreground text-sm">
          لقد قمت بالتسجيل وتأكيد بريدك مسبقاً. شكراً لثقتك بنا.
        </p>
      </div>
    )
  }

  if (success) {
    return (
      <div className="glass-panel p-6 rounded-2xl border border-primary/20 text-center animate-in fade-in zoom-in duration-500">
        <h3 className="text-xl font-bold text-primary mb-2">تم التسجيل بنجاح!</h3>
        <p className="text-muted-foreground text-sm mb-4">
          لقد أرسلنا رابط التأكيد إلى بريدك الإلكتروني. الرجاء التحقق من صندوق الوارد (أو البريد المزعج) وتأكيد تسجيلك لضمان الخصم.
        </p>
        <p className="text-xs text-white/50">
          لا تنسَ التأكيد لتكون من أول 500 شخص.
        </p>
      </div>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" dir="rtl">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="sr-only">البريد الإلكتروني</FormLabel>
              <FormControl>
                <Input 
                  placeholder="أدخل بريدك الإلكتروني هنا..." 
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
                  أوافق على <Link href="/privacy" className="text-primary underline underline-offset-4 hover:text-primary/80">سياسة الخصوصية</Link>
                  {" "}و<Link href="/terms" className="text-primary underline underline-offset-4 hover:text-primary/80">شروط الاستخدام</Link> وأرغب في الانضمام لقائمة الانتظار.
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

        <Button 
          type="submit" 
          disabled={isPending}
          className="w-full h-14 rounded-xl text-base font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_20px_rgba(212,175,55,0.3)] transition-all hover:shadow-[0_0_30px_rgba(212,175,55,0.5)]"
        >
          {isPending ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            "انضم الآن واحصل على الخصم"
          )}
        </Button>
      </form>
    </Form>
  )
}

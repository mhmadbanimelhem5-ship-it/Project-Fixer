export type Language = 'ar' | 'en';

export const waitlistLocales = {
  ar: {
    alreadyConfirmedTitle: "أنت مسجل بالفعل!",
    alreadyConfirmedDesc: "لقد قمت بالتسجيل وتأكيد بريدك مسبقاً. شكراً لثقتك بنا.",
    successTitle: "تم التسجيل بنجاح!",
    successDesc: "لقد أرسلنا رابط التأكيد إلى بريدك الإلكتروني. الرجاء التحقق من صندوق الوارد (أو البريد المزعج) وتأكيد تسجيلك لضمان الخصم.",
    successNote: "لا تنسَ التأكيد لتكون من أول 500 شخص.",
    emailPlaceholder: "أدخل بريدك الإلكتروني هنا...",
    privacyPrefix: "أوافق على ",
    privacyLink: "سياسة الخصوصية",
    and: " و",
    termsLink: "شروط الاستخدام",
    privacySuffix: " وأرغب في الانضمام لقائمة الانتظار.",
    errorGeneric: "حدث خطأ غير متوقع. حاول مرة أخرى.",
    emailInvalid: "الرجاء إدخال بريد إلكتروني صحيح",
    privacyRequired: "يجب الموافقة على سياسة الخصوصية",
    statsTitle: "انضم إلى قائمة الانتظار قبل اكتمال العرض",
    statsDescPrefix: "أكّد بريدك لتكون من أوائل ",
    statsDescSuffix: " شخصًا المؤهلين لخصم 50% مدى الحياة.",
    confirmed: "مؤكدون",
    spotsRemaining: "مقعد متبقٍ",
    offerFullPrefix: "اكتمل عرض خصم أول ",
    offerFullSuffix: " شخص",
    btnLoading: "جاري التسجيل...",
    btnSubmit: "انضم الآن واحصل على الخصم",
  },
  en: {
    alreadyConfirmedTitle: "You're already registered!",
    alreadyConfirmedDesc: "You have already registered and confirmed your email. Thank you for your trust.",
    successTitle: "Registration successful!",
    successDesc: "We've sent a confirmation link to your email. Please check your inbox (and spam folder) and confirm your registration.",
    successNote: "Don't forget to confirm to secure your spot.",
    emailPlaceholder: "Enter your email address...",
    privacyPrefix: "I agree to the ",
    privacyLink: "Privacy Policy",
    and: " and ",
    termsLink: "Terms of Use",
    privacySuffix: " and want to join the waitlist.",
    errorGeneric: "An unexpected error occurred. Please try again.",
    emailInvalid: "Please enter a valid email address",
    privacyRequired: "You must accept the privacy policy",
    statsTitle: "Join the waitlist before the offer ends",
    statsDescPrefix: "Confirm your email to be among the first ",
    statsDescSuffix: " eligible for a 50% lifetime discount.",
    confirmed: "confirmed",
    spotsRemaining: "spots remaining",
    offerFullPrefix: "The first ",
    offerFullSuffix: " discount spots have been filled",
    btnLoading: "Registering...",
    btnSubmit: "Join now to secure your discount",
  }
};

export const landingLocales = {
  ar: {
    dir: "rtl",
    nav: {
      features: "المميزات",
      screens: "داخل التطبيق",
      inheritance: "الإرث الرقمي",
      security: "الأمان",
      compare: "المقارنة"
    },
    hero: {
      badge: "تطبيق أندرويد متاح قريباً",
      title: "خزنتك الرقمية الشخصية",
      subtitle: "تم تصميم Auryx كخزنة شخصية تعتمد على بنية المعرفة الصفرية (Zero-Knowledge) وتشفير AES-256 لحماية كلمات المرور والملفات والملاحظات السرية. حماية تعتمد على التصميم الرياضي، وليس الوعود.",
      discountTitle: "احصل على خصم 50% مدى الحياة!",
      discountDesc: "أول 500 شخص يسجلون ويؤكدون بريدهم الإلكتروني سيحصلون على هذا الخصم الحصري عند الإطلاق."
    },
    features: {
      title: "تصميم يضع الخصوصية أولاً",
      subtitle: "نحن نبني حمايتك في صميم التطبيق، لتكون أنت المالك الوحيد لمفاتيحك.",
      e2ee: {
        title: "تشفير AES-256",
        desc: "تُشفر بياناتك على جهازك باستخدام معايير تشفير متقدمة من طرف إلى طرف (E2EE) قبل حفظها أو مزامنتها."
      },
      zeroKnowledge: {
        title: "بنية المعرفة الصفرية",
        desc: "نحن لا نحتفظ بمفاتيح فك التشفير ولا نستطيع الوصول إلى بياناتك. أنت الوحيد الذي يملك القدرة على فتح خزنتك."
      },
      storage: {
        title: "تخزين محلي مرن",
        desc: "لا يفرض التطبيق قيوداً مصطنعة على سعة التخزين المحلي؛ الحجم العملي للملفات يعتمد فقط على مساحة وأداء جهازك الشخصي."
      },
      twoFactor: {
        title: "مصادقة ثنائية (2FA)",
        desc: "طبقة حماية إضافية لتأمين حسابك ضد محاولات تسجيل الدخول غير المصرح بها."
      }
    },
    screens: {
      eyebrow: "نظرة من الداخل",
      title: "مصممة لتبقى واضحة عندما يهم الأمر",
      subtitle: "لقطات حقيقية من نسخة Android الحالية، من فتح الخزنة إلى الإعدادات والأوصياء.",
      alts: {
        lock: "شاشة فتح خزنة Auryx",
        home: "الشاشة الرئيسية في Auryx",
        guardians: "شاشة الأوصياء في Auryx",
        settings: "شاشة إعدادات Auryx"
      }
    },
    inheritance: {
      title: "الإرث الرقمي المُدار",
      subtitle: "نظام مصمم لنقل الوصول إلى من تثق بهم في حالة الطوارئ بطريقة تعتمد على اختيارك وموافقتهم.",
      step1: {
        title: "مراقبة عدم النشاط",
        desc: "تقوم بتحديد نافذة زمنية لعدم النشاط. يقوم التطبيق بمراقبة التفاعلات وفي حال عدم فتح الخزنة خلال هذه الفترة المحددة، تبدأ عملية الإرث."
      },
      step2: {
        title: "إشعار مسبق للأوصياء",
        desc: "كجزء من عملية الإعداد الأولى، يتم إبلاغ الأوصياء باختيارهم حتى لا يكون طلب الوصول مفاجئاً لهم لاحقاً."
      },
      step3: {
        title: "تأكيد المستفيدين",
        desc: "بعد انتهاء فترة عدم النشاط، يتطلب النظام تأكيد الأوصياء لطلب فك التشفير ونقل الوصول، وفقاً للشروط التي قمت بتكوينها مسبقاً."
      }
    },
    security: {
      title: "الشفافية والثقة",
      subtitle: "معلومات واضحة حول كيفية عملنا لحماية هويتك الرقمية.",
      sourceCode: {
        title: "الكود المصدري",
        desc: "في مرحلة الإطلاق الحالية، يعتبر كود التطبيق مغلق المصدر. نحن نلتزم بمشاركة مبادئنا الهندسية وبنية التشفير بشفافية تامة."
      },
      audit: {
        title: "تدقيق الأمان (مُخطط له)",
        desc: "نحن نخطط للتعاقد مع جهة خارجية مستقلة لإجراء تدقيق أمني شامل للكود والبنية التحتية، وسيتم نشر التقرير لاحقاً لضمان موثوقية التطبيق."
      },
      recovery: {
        title: "النسخ الاحتياطي والاسترداد",
        desc: "يمكنك إنشاء نسخة احتياطية مشفرة وحفظها بأمان. إذا نسيت PIN، تعتمد إمكانية استعادة الوصول على وجود نسخة احتياطية أو تفعيل خيارات الإرث والطوارئ مسبقاً؛ لا يستطيع الفريق تخطي PIN أو فك خزنتك نيابةً عنك."
      },
      privacy: {
        title: "موقع البيانات وحقوق الخصوصية",
        desc: "سيتم الإفصاح التفصيلي عن موقع البنية التحتية ومزودي الخدمة السحابية في سياسة الخصوصية النهائية قبل الإطلاق. التطبيق مصمم لدعم حقوق المستخدمين بموجب اللائحة العامة لحماية البيانات (GDPR) حيثما تنطبق."
      }
    },
    compare: {
      title: "مقارنة الميزات",
      subtitle: "كيف تختلف طريقة عمل Auryx في الجوانب الأساسية.",
      disclaimer: "جميع العلامات التجارية المذكورة تعود ملكيتها لأصحابها المعنيين. تعتمد هذه المقارنة على المعلومات العامة المتاحة.",
      feature: "الميزة",
      auryx: "Auryx",
      onepass: "1Password",
      bitwarden: "Bitwarden",
      rows: [
        { name: "التشفير من طرف إلى طرف (E2EE)", a: "نعم", b: "نعم", c: "نعم" },
        { name: "بنية المعرفة الصفرية", a: "نعم", b: "نعم", c: "نعم" },
        { name: "الإرث الرقمي والوصول في حالات الطوارئ", a: "ضمن خطة Auryx", b: "راجع ميزات المنتج الحالية", c: "وصول طوارئ" },
        { name: "التخزين المحلي", a: "يعتمد على مساحة الجهاز", b: "يعتمد على المنتج والخطة", c: "يعتمد على المنتج والخطة" },
        { name: "المنصة الحالية", a: "Android", b: "عدة منصات", c: "عدة منصات" }
      ]
    },
    pricing: {
      eyebrow: "تسعير واضح",
      title: "اختر ما يناسبك عند الإطلاق",
      subtitle: "الاشتراكات ستكون داخل التطبيق عبر Google Play. سعر الإطلاق النهائي سيظهر بوضوح قبل الدفع.",
      monthly: {
        title: "شهري",
        price: "$5.99",
        period: "شهرياً",
        discount: "لأول 500 شخص مؤكد: $2.99 مدى الحياة",
        features: ["ميزات الإرث والطوارئ ضمن الخطة المدفوعة", "الدفع والإلغاء عبر Google Play"]
      },
      annual: {
        title: "سنوي",
        price: "$45.99",
        period: "سنوياً",
        discount: "لأول 500 شخص مؤكد: $22.99 مدى الحياة",
        features: ["قيمة أفضل لمن يختار الدفع السنوي", "الدفع والإلغاء عبر Google Play"]
      },
      note: "الأسعار والخطط المعروضة مبدئية وقد تتغير قبل الإطلاق النهائي. الخصم مرتبط بنفس البريد الإلكتروني المؤكد في قائمة الانتظار والتطبيق."
    },
    community: {
      title: "مجتمع الوصول المبكر",
      desc: "انضم إلى مجموعة المتبنين الأوائل وساعدنا في تشكيل مستقبل Auryx (رابط منصة المجتمع - قريباً).",
      signals: ["متبنو الإطلاق الأوائل — قريباً", "تدقيق أمني مستقل — مخطط له", "الكود مغلق المصدر حالياً"]
    },
    platforms: "يدعم التطبيق منصة Android حالياً، مع وجود خطط لتطوير منصات أخرى لاحقاً.",
    footer: {
      rights: "جميع الحقوق محفوظة.",
      team: "مُطور بعناية واهتمام بالغ بالخصوصية من قبل فريق Auryx.",
      links: {
        privacy: "سياسة الخصوصية",
        terms: "شروط الاستخدام"
      }
    }
  },
  en: {
    dir: "ltr",
    nav: {
      features: "Features",
      screens: "Inside the app",
      inheritance: "Digital Inheritance",
      security: "Security",
      compare: "Compare"
    },
    hero: {
      badge: "Android App Coming Soon",
      title: "Your Personal Digital Vault",
      subtitle: "Auryx is built on a zero-knowledge architecture using AES-256 end-to-end encryption to protect your passwords, files, and secrets. Security driven by design, not promises.",
      discountTitle: "Get a 50% Lifetime Discount!",
      discountDesc: "The first 500 people to sign up and confirm their email will receive this exclusive discount at launch."
    },
    features: {
      title: "Privacy-First Design",
      subtitle: "We build protection directly into the application's core. You hold the only keys.",
      e2ee: {
        title: "AES-256 Encryption",
        desc: "Your data is secured on your device using AES-256 end-to-end encryption (E2EE) before it is ever saved or synced."
      },
      zeroKnowledge: {
        title: "Zero-Knowledge Architecture",
        desc: "We do not hold your decryption keys and cannot access your data. You are the sole entity capable of unlocking your vault."
      },
      storage: {
        title: "Flexible Local Storage",
        desc: "The app imposes no artificial quotas on local storage; practical file size limits depend entirely on your device's capacity and performance."
      },
      twoFactor: {
        title: "Two-Factor Authentication (2FA)",
        desc: "An additional layer of account protection against unauthorized login attempts."
      }
    },
    screens: {
      eyebrow: "A closer look",
      title: "Clear when it matters",
      subtitle: "Real screenshots from the current Android build, from vault unlock to settings and guardians.",
      alts: {
        lock: "Auryx vault unlock screen",
        home: "Auryx home screen",
        guardians: "Auryx guardians screen",
        settings: "Auryx settings screen"
      }
    },
    inheritance: {
      title: "Managed Digital Inheritance",
      subtitle: "A system designed to transfer vault access to trusted individuals in emergencies, based on your terms and their confirmation.",
      step1: {
        title: "Inactivity Monitoring",
        desc: "You configure an inactivity time window. The app monitors for interactions; if the vault is not opened within this specified period, the inheritance process initiates."
      },
      step2: {
        title: "Advance Guardian Notification",
        desc: "As part of the initial setup, guardians are informed of their selection so the access request process is never a surprise."
      },
      step3: {
        title: "Beneficiary Confirmation",
        desc: "Once the inactivity period lapses, guardians must confirm the request to decrypt and transfer access, strictly following the conditions you configured."
      }
    },
    security: {
      title: "Transparency & Trust",
      subtitle: "Clear information about how we operate to protect your digital identity.",
      sourceCode: {
        title: "Source Code",
        desc: "At this early launch stage, the Auryx application code is closed source. We are committed to transparency regarding our engineering principles and encryption architecture."
      },
      audit: {
        title: "Security Audit (Planned)",
        desc: "We plan to commission an independent third-party security audit of our code and infrastructure. The report will be published publicly upon completion."
      },
      recovery: {
        title: "Backup & Recovery",
        desc: "You can create and securely store an encrypted backup. If you forget your PIN, recovery depends on having that backup or configuring inheritance and emergency options in advance; the team cannot bypass your PIN or decrypt your vault for you."
      },
      privacy: {
        title: "Data Location & Privacy Rights",
        desc: "Infrastructure providers and final data-processing locations will be detailed in the privacy policy before launch. The application is designed to support GDPR user rights where applicable."
      }
    },
    compare: {
      title: "Feature Comparison",
      subtitle: "How Auryx's approach differs in key areas.",
      disclaimer: "All trademarks belong to their respective owners. This comparison is based on publicly available information.",
      feature: "Feature",
      auryx: "Auryx",
      onepass: "1Password",
      bitwarden: "Bitwarden",
      rows: [
        { name: "End-to-End Encryption (E2EE)", a: "Yes", b: "Yes", c: "Yes" },
        { name: "Zero-Knowledge Architecture", a: "Yes", b: "Yes", c: "Yes" },
        { name: "Digital inheritance and emergency access", a: "Planned for Auryx", b: "Review current product features", c: "Emergency access" },
        { name: "Local storage", a: "Device capacity dependent", b: "Product and plan dependent", c: "Product and plan dependent" },
        { name: "Current platform", a: "Android", b: "Multiple platforms", c: "Multiple platforms" }
      ]
    },
    pricing: {
      eyebrow: "Clear pricing",
      title: "Choose what fits at launch",
      subtitle: "Subscriptions will be handled in-app through Google Play. The final launch price will be shown clearly before payment.",
      monthly: {
        title: "Monthly",
        price: "$5.99",
        period: "per month",
        discount: "$2.99 for life for the first 500 confirmed people",
        features: ["Inheritance and emergency features within the paid plan", "Billing and cancellation through Google Play"]
      },
      annual: {
        title: "Annual",
        price: "$45.99",
        period: "per year",
        discount: "$22.99 for life for the first 500 confirmed people",
        features: ["Better value for an annual commitment", "Billing and cancellation through Google Play"]
      },
      note: "Displayed prices and plans are preliminary and may change before final launch. Eligibility is tied to the same confirmed email used for the waitlist and app."
    },
    community: {
      title: "Early Access Community",
      desc: "Join our early adopters and help shape the future of Auryx (Community platform link placeholder).",
      signals: ["Early launch adopters — coming soon", "Independent security audit — planned", "Currently closed source"]
    },
    platforms: "Currently supporting Android. More platforms are in development.",
    footer: {
      rights: "All rights reserved.",
      team: "Built with care and a commitment to privacy by the Auryx team.",
      links: {
        privacy: "Privacy Policy",
        terms: "Terms of Use"
      }
    }
  }
};

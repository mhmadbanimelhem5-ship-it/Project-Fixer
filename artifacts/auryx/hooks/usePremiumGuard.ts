import { useCallback, useEffect, useState } from 'react';
import Purchases from 'react-native-purchases';
import { useRouter } from 'expo-router';

// تعريف أنواع الميزات المدفوعة لضمان التوحيد
export type PremiumFeature = 
  | 'secrets_limit'   // الحد الأقصى للأسرار المجانية (6)
  | 'add_guardian'    // إضافة أوصياء جدد
  | 'legacy_setup'    // تفعيل أو إعداد الإرث الرقمي
  | 'decoy_vault'     // إنشاء أو فتح الخزنة الوهمية
  | 'emergency_mode'; // تفعيل بروتوكول الطوارئ

/**
 * Hook مركزي للتحقق من حالة اشتراك المستخدم (Premium Entitlement).
 * يعتمد حصرياً على RevenueCat كمصدر حقيقة، ولا يقبل Flags محلية.
 */
export function usePremiumGuard() {
  const router = useRouter();
  
  // تخزين الحالة محلياً لتجنب استدعاء API في كل ضغطة زر
  const [isPremium, setIsPremium] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // جلب حالة الاشتراك عند تحميل الـ Hook
  useEffect(() => {
    const fetchEntitlements = async () => {
      try {
        const customerInfo = await Purchases.getCustomerInfo();
        // ⚠️ ملاحظة: تأكد من أن اسم الـ Package في لوحة RevenueCat هو 'premium'
        const hasAccess = !!customerInfo.entitlements.active['premium'];
        setIsPremium(hasAccess);
      } catch (error) {
        console.warn('[PremiumGuard] Failed to fetch entitlements:', error);
        setIsPremium(false); // في حال الخطأ، نفترض أنه غير مشترك للأمان
      } finally {
        setIsLoading(false);
      }
    };

    fetchEntitlements();

    // الاستماع للتغييرات الفورية بعد الشراء الناجح
    const subscriber = Purchases.addCustomerInfoUpdateListener((info) => {
      setIsPremium(!!info.entitlements.active['premium']);
    });

    return () => subscriber.remove();
  }, []);

  /**
   * الدالة الرئيسية للفحص والحماية (Gatekeeping)
   * @param feature نوع الميزة التي يحاول المستخدم الوصول إليها
   * @returns Promise<boolean> - true إذا سُمح بالمرور، false إذا تم اعتراضه وفتح Paywall
   */
  const checkAndGate = useCallback(async (feature: PremiumFeature): Promise<boolean> => {
    if (isLoading) return false; // منع الإجراءات أثناء التحميل الأولي
    
    if (isPremium) return true; // المستخدم مشترك -> اسمح بالمرور فوراً

    // المستخدم مجاني -> امنع العملية وافتح شاشة الاشتراك الحالية
    // نمرر سبب الفتح لتخصيص عنوان الـ Paywall ديناميكياً
    router.push({
      pathname: '/(tabs)/subscription',
      params: { source: feature }
    });
    
    return false; // إيقاف تنفيذ الوظيفة الأصلية
  }, [router, isPremium, isLoading]);

  return { 
    isPremium, 
    isLoading, 
    checkAndGate,
    refreshStatus: async () => {
      const info = await Purchases.getCustomerInfo();
      setIsPremium(!!info.entitlements.active['premium']);
    }
  };
}
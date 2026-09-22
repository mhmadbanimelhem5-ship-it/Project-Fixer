import { useCallback, useEffect, useState } from 'react';
import Purchases from 'react-native-purchases';
import { useRouter } from 'expo-router';

export type PremiumFeature =
  | 'secrets_limit'
  | 'add_guardian'
  | 'legacy_setup'
  | 'decoy_vault'
  | 'emergency_mode';

export function usePremiumGuard() {
  const router = useRouter();
  const [isPremium, setIsPremium] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const fetchEntitlements = async () => {
      try {
        const customerInfo = await Purchases.getCustomerInfo();
        const hasAccess = !!customerInfo.entitlements.active['premium'];
        setIsPremium(hasAccess);
      } catch (error) {
        console.warn('[PremiumGuard] Failed to fetch entitlements:', error);
        setIsPremium(false);
      } finally {
        setIsLoading(false);
      }
    };

    fetchEntitlements();

    // (any) نتجاهل اختلاف نوع الإرجاع بين إصدارات RevenueCat نهائياً
    const subscriber: any = Purchases.addCustomerInfoUpdateListener((info: any) => {
      setIsPremium(!!info.entitlements.active['premium']);
    });

    return () => {
      if (typeof subscriber === 'function') subscriber();
      else subscriber?.remove?.();
    };
  }, []);

  const checkAndGate = useCallback(async (feature: PremiumFeature): Promise<boolean> => {
    if (isLoading) return false;
    if (isPremium) return true;

    // (as any) يكسر صرامة typed routes على الجوال؛ المسار الفعلي /subscription بدون أقواس
    (router.push as any)({
      pathname: '/subscription',
      params: { source: feature },
    });

    return false;
  }, [router, isPremium, isLoading]);

  return {
    isPremium,
    isLoading,
    checkAndGate,
    refreshStatus: async () => {
      const info = await Purchases.getCustomerInfo();
      setIsPremium(!!info.entitlements.active['premium']);
    },
  };
}
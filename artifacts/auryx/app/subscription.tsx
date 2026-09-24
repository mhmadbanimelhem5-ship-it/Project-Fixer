import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import Purchases from 'react-native-purchases';
import * as Font from 'expo-font';
import { GlassCard } from '@/components/GlassCard'; 
import colors from '@/constants/colors';
import { useTheme, ThemeColors } from '@/contexts/ThemeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLocalSearchParams } from 'expo-router';

// ── Types ───────────────────────────────────────────────────────────────────
interface PackageOffer {
  id: string;
  title: string;
  price: string;
  period: string;
  isBestValue?: boolean;
  discountLabel?: string;
}

const MOCK_PACKAGES: PackageOffer[] = [
  {
    id: 'monthly',
    title: 'شهري',
    price: '$4.99',
    period: '/ شهرياَ',
  },
  {
    id: 'yearly',
    title: 'سنوي',
    price: '$39.99',
    period: '/ سنوياَ',
    isBestValue: true,
    discountLabel: 'وفّر ٣٣٪',
  },
];

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const { colors: tc } = useTheme();
  const { t } = useLanguage();
  const { source } = useLocalSearchParams<{ source?: string }>();

  const [selectedPackageId, setSelectedPackageId] = useState<string>('yearly');
  const [isLoading, setIsLoading] = useState(false);
  const [packages, setPackages] = useState<PackageOffer[]>(MOCK_PACKAGES);
  const [fontLoaded, setFontLoaded] = useState(false);

  // Load Font
  useEffect(() => {
    const loadFont = async () => {
      try {
        await Font.loadAsync({
          'Cairo-Bold': require('../assets/fonts/Cairo.ttf'),
          'Cairo-Regular': require('../assets/fonts/Cairo.ttf'),
        });
        setFontLoaded(true);
      } catch (error) {
        console.warn('Font loading failed:', error);
        setFontLoaded(true);
      }
    };
    loadFont();
  }, []);

  // Fetch Offers Logic
  useEffect(() => {
    const fetchOffers = async () => {
      try {
        const offerings = await Purchases.getOfferings();
        const current = offerings.current;
        if (current && current.availablePackages.length > 0) {
          const mapped = current.availablePackages.map(pkg => ({
            id: pkg.packageType === 'ANNUAL' ? 'yearly' : 
                 pkg.packageType === 'MONTHLY' ? 'monthly' : pkg.identifier,
            title: pkg.packageType === 'ANNUAL' ? 'سنوي' : 'شهري',
            price: pkg.product.priceString,
            period: pkg.packageType === 'ANNUAL' ? '/ سنوياَ' : '/ شهرياَ',
            isBestValue: pkg.packageType === 'ANNUAL',
            discountLabel: pkg.packageType === 'ANNUAL' ? 'وفّر ٣٣٪' : undefined,
          }));
          setPackages(mapped);
          const bestVal = mapped.find(p => p.isBestValue);
          if (bestVal) setSelectedPackageId(bestVal.id);
        }
      } catch (error) {
        console.warn('Failed to load offers:', error);
      }
    };
    fetchOffers();
  }, []);

  // Dynamic Content Logic
  const dynamicContent = useMemo(() => {
    switch (source) {
      case 'secrets_limit': return { title: t('sub.dynamicTitles.secrets'), subtitle: t('sub.dynamicSubtitles.secrets') };
      case 'add_guardian': return { title: t('sub.dynamicTitles.guardians'), subtitle: t('sub.dynamicSubtitles.guardians') };
      case 'legacy_setup': return { title: t('sub.dynamicTitles.legacy'), subtitle: t('sub.dynamicSubtitles.legacy') };
      case 'decoy_vault': return { title: t('sub.dynamicTitles.decoy'), subtitle: t('sub.dynamicSubtitles.decoy') };
      case 'emergency_mode': return { title: t('sub.dynamicTitles.emergency'), subtitle: t('sub.dynamicSubtitles.emergency') };
      default: return { title: t('sub.title'), subtitle: t('sub.subtitle') };
    }
  }, [source, t]);

  const handleSubscribe = useCallback(async () => {
    if (!selectedPackageId) return;
    setIsLoading(true);
    try {
      const offering = await Purchases.getOfferings();
      const targetPackage = offering.current?.availablePackages?.find(
        pkg => 
          (pkg.packageType === 'ANNUAL' && selectedPackageId === 'yearly') ||
          (pkg.packageType === 'MONTHLY' && selectedPackageId === 'monthly') ||
          pkg.identifier === selectedPackageId
      );
      if (!targetPackage) throw new Error('Package not found');

      const purchaseResult = await Purchases.purchasePackage(targetPackage);
      if (purchaseResult.customerInfo.entitlements.active['premium']) {
        Alert.alert(t('sub.successTitle'), t('sub.successMessage'));
      } else {
        Alert.alert(t('sub.errorTitle'), t('sub.errorMessage'));
      }
    } catch (err: any) {
      if (!err.userCancelled) Alert.alert(t('sub.errorTitle'), err.message || t('sub.unknownError'));
    } finally {
      setIsLoading(false);
    }
  }, [selectedPackageId, t]);

  if (!fontLoaded) {
    return <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}><ActivityIndicator size="large" color={tc.gold} /></View>;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Background Glow Effect */}
      <LinearGradient
        colors={['rgba(212,175,55,0.1)', 'transparent']}
        start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Hero Section */}
        <View style={styles.heroSection}>
          <Image 
            source={require('../assets/images/shield.png')} 
            style={styles.shieldImage}
            resizeMode="contain"
          />

          <Text style={[styles.mainTitle, { fontFamily: 'Cairo-Bold', color: '#FFFFFF' }]}>
            {dynamicContent.title}
          </Text>

          {/* Gold Divider Line */}
          <View style={styles.dividerLine} />

          <Text style={[styles.subTitle, { fontFamily: 'Cairo-Regular', color: tc.textSecondary }]}>
            {dynamicContent.subtitle}
          </Text>
        </View>

        {/* Features Grid Card */}
        <GlassCard style={styles.featuresCard}>
          <View style={styles.featuresRow}>
            <FeatureItem icon="lock" label="عدد غير محدود من الخزائن المشفرة" />
            <FeatureItem icon="users" label="إضافة حتى 10 حراس موثوقين للتصويت المشترك" />
            <FeatureItem icon="clock" label="تنبيهات غياب ذكية وتلقائية (Proof of Life)" />
          </View>
        </GlassCard>

        {/* Pricing Cards Container */}
        <View style={styles.pricingContainer}>
          {packages.map((pkg) => (
            <TouchableOpacity
              key={pkg.id}
              onPress={() => !isLoading && setSelectedPackageId(pkg.id)}
              activeOpacity={0.9}
              disabled={isLoading}
              style={styles.cardTouchWrapper}
            >
              <View style={[
                styles.priceCardBase,
                selectedPackageId === pkg.id ? styles.selectedPriceCardBorder : {},
                pkg.isBestValue ? styles.bestValueBg : {}
              ]}>

                {/* Best Value Badge (Inside Top Right) */}
                {pkg.isBestValue && (
                  <View style={styles.badgeContainer}>
                    <Text style={[styles.badgeText, { fontFamily: 'Cairo-Bold' }]}>الأفضل قيمة 👑</Text>
                  </View>
                )}

                {/* Selection Checkmark (Top Left) */}
                {selectedPackageId === pkg.id && (
                  <View style={styles.checkCircle}>
                    <Feather name="check" size={16} color="#0A0F1E" />
                  </View>
                )}

                <Text style={[styles.pkgName, { fontFamily: 'Cairo-Bold', color: tc.text }]}>
                  {pkg.title}
                </Text>

                <View style={styles.priceBlock}>
                  <Text style={[styles.priceAmount, { fontFamily: 'Cairo-Bold', color: tc.gold }]}>
                    {pkg.price}
                  </Text>
                  <Text style={[styles.periodText, { fontFamily: 'Cairo-Regular', color: tc.textMuted }]}>
                    {pkg.period}
                  </Text>
                </View>

                {/* Discount Label */}
                {pkg.discountLabel && (
                  <View style={styles.discountPill}>
                    <Text style={[styles.discountText, { fontFamily: 'Cairo-Regular' }]}>
                      {pkg.discountLabel}
                    </Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Free Trial Banner */}
        <View style={styles.trialBanner}>
           <View style={styles.giftIconWrap}>
             <Feather name="gift" size={20} color={tc.gold} />
           </View>
           <View style={styles.trialTextWrap}>
             <Text style={[styles.trialTitle, { fontFamily: 'Cairo-Bold', color: tc.text }]}>
               جربه مجاناً لمدة 7 أيام
             </Text>
             <Text style={[styles.trialSubtitle, { fontFamily: 'Cairo-Regular', color: tc.textSecondary }]}>
               استمتع بجميع مزايا Premium قبل الدفع.
             </Text>
           </View>
           <Feather name="arrow-left" size={20} color={tc.gold} />
        </View>

        {/* CTA Button */}
        <TouchableOpacity
          onPress={handleSubscribe}
          disabled={isLoading}
          activeOpacity={0.8}
          style={styles.ctaButtonShadow}
        >
          <LinearGradient
            colors={[tc.gold, '#DAA520']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.ctaButton}
          >
            {isLoading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <>
                <Feather name="credit-card" size={20} color="#000" style={{ marginRight: 10 }} />
                <Text style={[styles.ctaText, { fontFamily: 'Cairo-Bold' }]}>
                  ابدأ الاشتراك الآمن
                </Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>

        <Text style={[styles.footerNote, { fontFamily: 'Cairo-Regular', color: tc.textMuted }]}>
          يمكنك الإلغاء في أي وقت. سيتم التجديد تلقائياً حسب الخطة المختارة.
        </Text>

      </ScrollView>
    </View>
  );
}

// Helper Component for Features
const FeatureItem = ({ icon, label }: { icon: keyof typeof Feather.glyphMap, label: string }) => {
  const { colors: tc } = useTheme();
  return (
    <View style={styles.featureCol}>
      <View style={styles.featureIconBox}>
        <Feather name={icon} size={18} color={tc.gold} />
      </View>
      <Text style={[styles.featureLabel, { fontFamily: 'Cairo-Regular', color: tc.textSecondary }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
};

// ── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F19', 
  },
  scrollContent: {
    paddingBottom: 40,
    paddingHorizontal: 20,
  },

  // Hero
  heroSection: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 30,
  },
  shieldImage: {
    width: 160,
    height: 160,
    marginBottom: 16,
  },
  mainTitle: {
    fontSize: 26,
    textAlign: 'center',
    lineHeight: 34,
    letterSpacing: 0.5,
    writingDirection: 'rtl',
  },
  dividerLine: {
    width: 60,
    height: 3,
    backgroundColor: tc.gold,
    borderRadius: 2,
    marginVertical: 12,
  },
  subTitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 10,
    writingDirection: 'rtl',
  },

  // Features Card
  featuresCard: {
    padding: 20,
    marginBottom: 24,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  featuresRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  featureCol: {
    flex: 1,
    alignItems: 'center',
  },
  featureIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(212,175,55,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  featureLabel: {
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
    writingDirection: 'rtl',
  },

  // Pricing
  pricingContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  cardTouchWrapper: {
    flex: 1,
  },
  priceCardBase: {
    backgroundColor: '#151B2B', 
    borderRadius: 20,
    padding: 20,
    minHeight: 180,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    position: 'relative',
    overflow: 'hidden', 
  },
  selectedPriceCardBorder: {
    borderColor: tc.gold,
    borderWidth: 2,
    shadowColor: tc.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  bestValueBg: {
    backgroundColor: '#1A2135', 
  },
  badgeContainer: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: tc.purple, 
    borderBottomLeftRadius: 12,
    borderTopRightRadius: 19, 
    paddingHorizontal: 12,
    paddingVertical: 6,
    zIndex: 10,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  checkCircle: {
    position: 'absolute',
    top: 15,
    left: 15,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: tc.green,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  pkgName: {
    fontSize: 18,
    marginBottom: 10,
    marginTop: 10, 
    writingDirection: 'rtl',
  },
  priceBlock: {
    flexDirection: 'column', 
    alignItems: 'flex-start',
  },
  priceAmount: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -1,
  },
  periodText: {
    fontSize: 13,
    marginTop: 2,
  },
  discountPill: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(212,175,55,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1, // ← FIX: Changed from invalid CSS syntax
    borderColor: 'rgba(212,175,55,0.3)', // ← FIX: Split into separate properties
  },
  discountText: {
    color: tc.gold,
    fontSize: 12,
    fontWeight: '600',
  },

  // Trial Banner
  trialBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#151B2B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  giftIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(212,175,55,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  trialTextWrap: {
    flex: 1,
  },
  trialTitle: {
    fontSize: 15,
    marginBottom: 2,
    writingDirection: 'rtl',
  },
  trialSubtitle: {
    fontSize: 12,
    writingDirection: 'rtl',
  },

  // CTA
  ctaButtonShadow: {
    shadowColor: tc.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
    borderRadius: 16,
    marginBottom: 16,
  },
  ctaButton: {
    height: 56,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
  },
  footerNote: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
    opacity: 0.6,
    writingDirection: 'rtl',
  },
});

const styles = makeStyles(colors.dark);
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import Purchases from 'react-native-purchases'; // ← المكتبة الرسمية لـ RevenueCat
import { GlassCard } from '@/components/GlassCard';
import { ScreenGlow } from '@/components/shared/ScreenGlow';
import colors from '@/constants/colors';
import { useTheme, ThemeColors } from '@/contexts/ThemeContext';
import { useLanguage } from '@/contexts/LanguageContext';

// ── Types for Packages ────────────────────────────────────────────────────────
interface PackageOffer {
  id: string;
  title: string;
  price: string;
  period: string;
  isBestValue?: boolean;
}

const MOCK_PACKAGES: PackageOffer[] = [
  {
    id: 'monthly',
    title: 'شهري',
    price: '$4.99',
    period: '/ شهرياً',
  },
  {
    id: 'yearly',
    title: 'سنوي',
    price: '$39.99',
    period: '/ سنوياً',
    isBestValue: true,
  },
];

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const { colors: tc } = useTheme();
  const { t } = useLanguage();
  
  const [selectedPackageId, setSelectedPackageId] = useState<string>('yearly');
  const [isLoading, setIsLoading] = useState(false);
  const [packages, setPackages] = useState<PackageOffer[]>(MOCK_PACKAGES);

  // Fetch real packages from RevenueCat when component mounts
  useEffect(() => {
    const fetchOffers = async () => {
      try {
        const offerings = await Purchases.getOfferings();
        if (offerings.current?.availablePackages.length > 0) {
          // Map RC packages to our UI format
          const mapped = offerings.current.availablePackages.map(pkg => ({
            id: pkg.packageType === 'ANNUAL' ? 'yearly' : 
                 pkg.packageType === 'MONTHLY' ? 'monthly' : pkg.identifier,
            title: pkg.packageType === 'ANNUAL' ? 'سنوي' : 'شهري',
            price: pkg.product.priceString,
            period: pkg.packageType === 'ANNUAL' ? '/ سنوياً' : '/ شهرياً',
            isBestValue: pkg.packageType === 'ANNUAL', // Usually annual is best value
          }));
          setPackages(mapped);
          
          // Auto-select the best value package initially
          const bestVal = mapped.find(p => p.isBestValue);
          if (bestVal) setSelectedPackageId(bestVal.id);
        }
      } catch (error) {
        console.warn('Failed to load offers:', error);
        // Fallback to mock data already set
      }
    };
    
    fetchOffers();
  }, []);

  const handleSubscribe = useCallback(async () => {
    if (!selectedPackageId) return;
    
    setIsLoading(true);
    try {
      const offering = await Purchases.getOfferings();
      const targetPackage = offering.current?.availablePackages.find(
        pkg => 
          (pkg.packageType === 'ANNUAL' && selectedPackageId === 'yearly') ||
          (pkg.packageType === 'MONTHLY' && selectedPackageId === 'monthly') ||
          pkg.identifier === selectedPackageId
      );

      if (!targetPackage) throw new Error('Package not found');

      const purchaseResult = await Purchases.purchasePackage(targetPackage);
      
      if (purchaseResult.customerInfo.entitlements.active['premium']) {
        Alert.alert(t('sub.successTitle'), t('sub.successMessage'));
        // Navigate back or update state locally
      } else {
        Alert.alert(t('sub.errorTitle'), t('sub.errorMessage'));
      }
    } catch (err: any) {
      if (err.userCancelled) {
        // User closed payment sheet — silent fail
      } else {
        Alert.alert(t('sub.errorTitle'), err.message || t('sub.unknownError'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [selectedPackageId, t]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenGlow variant="gold" intensity={0.15} />
      
      {/* Header Section */}
      <View style={styles.headerSection}>
        <LinearGradient
          colors={['rgba(212,175,55,0.2)', 'transparent']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.headerBg}
        >
          <Feather name="shield" size={48} color={tc.gold} style={styles.logoIcon} />
          <Text style={[styles.title, { color: tc.text }]}>
            {t('sub.title')}
          </Text>
          <Text style={[styles.subtitle, { color: tc.textSecondary }]}>
            {t('sub.subtitle')}
          </Text>
        </LinearGradient>
      </View>

      {/* Features List */}
      <ScrollView 
        contentContainerStyle={styles.featuresList}
        showsVerticalScrollIndicator={false}
      >
        {[
          { icon: 'lock', text: t('sub.feature1') },
          { icon: 'users', text: t('sub.feature2') },
          { icon: 'clock', text: t('sub.feature3') },
          { icon: 'file-text', text: t('sub.feature4') },
        ].map((feature, idx) => (
          <View key={idx} style={styles.featureItem}>
            <View style={[styles.featureIconWrap, { backgroundColor: `${tc.gold}15` }]}>
              <Feather name={feature.icon as any} size={16} color={tc.gold} />
            </View>
            <Text style={[styles.featureText, { color: tc.textSecondary }]}>
              {feature.text}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* Pricing Cards */}
      <View style={styles.pricingContainer}>
        {packages.map((pkg) => (
          <TouchableOpacity
            key={pkg.id}
            onPress={() => !isLoading && setSelectedPackageId(pkg.id)}
            activeOpacity={0.8}
            disabled={isLoading}
          >
            <GlassCard 
              style={[
                styles.priceCard,
                selectedPackageId === pkg.id && styles.selectedPriceCard,
                pkg.isBestValue && styles.bestValueBadgeParent
              ]}
            >
              {pkg.isBestValue && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{t('sub.bestValue')}</Text>
                </View>
              )}
              
              <Text style={[styles.pkgTitle, { color: tc.text }]}>
                {pkg.title}
              </Text>
              <View style={styles.priceRow}>
                <Text style={[styles.priceAmount, { color: tc.gold }]}>
                  {pkg.price}
                </Text>
                <Text style={[styles.pricePeriod, { color: tc.textMuted }]}>
                  {pkg.period}
                </Text>
              </View>
              
              {selectedPackageId === pkg.id && (
                <View style={styles.checkmarkWrap}>
                  <Feather name="check-circle" size={20} color={tc.green} />
                </View>
              )}
            </GlassCard>
          </TouchableOpacity>
        ))}
      </View>

      {/* CTA Button */}
      <View style={styles.ctaContainer}>
        <TouchableOpacity
          onPress={handleSubscribe}
          disabled={isLoading}
          activeOpacity={0.9}
        >
          <LinearGradient
            colors={[tc.gold, '#B8960C']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.subscribeBtn}
          >
            {isLoading ? (
              <ActivityIndicator color="#0A0F1E" />
            ) : (
              <>
                <Feather name="credit-card" size={18} color="#0A0F1E" style={{ marginRight: 8 }} />
                <Text style={styles.btnText}>
                  {t('sub.ctaButton')}
                </Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>
        
        <Text style={[styles.termsText, { color: tc.textMuted }]}>
          {t('sub.termsNote')}
        </Text>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tc.background,
  },
  headerSection: {
    position: 'relative',
    overflow: 'hidden',
  },
  headerBg: {
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  logoIcon: {
    marginBottom: 16,
    opacity: 0.9,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.5,
    writingDirection: 'rtl',
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
    maxWidth: '85%',
    writingDirection: 'rtl',
  },
  featuresList: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  featureIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    fontSize: 14,
    flex: 1,
    writingDirection: 'rtl',
  },
  pricingContainer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 12,
  },
  priceCard: {
    padding: 20,
    borderWidth: 1.5,
    borderColor: tc.border,
    minHeight: 100,
    justifyContent: 'center',
  },
  selectedPriceCard: {
    borderColor: tc.gold,
    shadowColor: tc.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  bestValueBadgeParent: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -10,
    right: 16,
    backgroundColor: tc.purple,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    zIndex: 10,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  pkgTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    writingDirection: 'rtl',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  priceAmount: {
    fontSize: 24,
    fontWeight: '800',
  },
  pricePeriod: {
    fontSize: 13,
    fontWeight: '500',
  },
  checkmarkWrap: {
    position: 'absolute',
    bottom: 16,
    left: 16,
  },
  ctaContainer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
  },
  subscribeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    shadowColor: tc.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  btnText: {
    color: '#0A0F1E',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  termsText: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 16,
    writingDirection: 'rtl',
  },
});

const styles = makeStyles(colors.dark); // Default theme fallback
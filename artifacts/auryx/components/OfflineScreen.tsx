/**
 * OfflineScreen.tsx
 *
 * Full-screen overlay shown whenever isConnected === false.
 * Sits at the top of the view stack (zIndex 9998, just below AnimatedSplash).
 * Supports Arabic/English via LanguageContext.
 */

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNetwork } from '@/contexts/NetworkContext';
import { useLanguage } from '@/contexts/LanguageContext';

const ND = Platform.OS !== 'web';

// ─── i18n strings ─────────────────────────────────────────────────────────────

const STRINGS = {
  ar: {
    title:    'لا يوجد اتصال بالإنترنت',
    body:     'يتطلب Auryx اتصالاً بالإنترنت لضمان أمان\nبياناتك وحماية التواصل مع المستفيدين.',
    retry:    'إعادة المحاولة',
    checking: 'جارٍ الفحص...',
    offline:  'تصفح بدون إنترنت (عرض فقط)',
  },
  en: {
    title:    'No Internet Connection',
    body:     'Auryx requires an internet connection to\nsecure your data and guardian communications.',
    retry:    'Retry',
    checking: 'Checking…',
    offline:  'Browse Offline (view only)',
  },
} as const;

// ─── Animated wifi-off icon (three arcs + cross) ──────────────────────────────

function WifiOffIcon({ size = 80 }: { size?: number }) {
  const pulse = useRef(new Animated.Value(1)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    loopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 900, useNativeDriver: ND, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulse, { toValue: 1,    duration: 900, useNativeDriver: ND, easing: Easing.inOut(Easing.ease) }),
      ]),
    );
    loopRef.current.start();
    return () => loopRef.current?.stop();
  }, []);

  return (
    <Animated.View style={{ transform: [{ scale: pulse }], alignItems: 'center', justifyContent: 'center' }}>
      {/* Outer red ring */}
      <View style={[styles.iconRing, { width: size, height: size, borderRadius: size / 2, borderColor: '#EF4444' }]} />
      {/* Inner circle */}
      <View style={[styles.iconInner, { width: size * 0.55, height: size * 0.55, borderRadius: size * 0.275 }]}>
        {/* Wifi bars represented as three horizontal lines */}
        <View style={[styles.wifiBar, { width: size * 0.34, height: 3, marginBottom: 5, opacity: 0.35 }]} />
        <View style={[styles.wifiBar, { width: size * 0.22, height: 3, marginBottom: 5, opacity: 0.5 }]} />
        <View style={[styles.wifiBar, { width: size * 0.10, height: 3 }]} />
      </View>
      {/* Diagonal slash */}
      <View
        style={{
          position: 'absolute',
          width: size * 0.65,
          height: 2.5,
          backgroundColor: '#EF4444',
          borderRadius: 2,
          transform: [{ rotate: '-45deg' }],
        }}
      />
    </Animated.View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function OfflineScreen() {
  const { isChecking, recheckConnectivity, enableOfflineMode } = useNetwork();
  const { language } = useLanguage();
  const t = STRINGS[language === 'ar' ? 'ar' : 'en'];

  // Slide-up entrance
  const slideY  = useRef(new Animated.Value(40)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 380, useNativeDriver: ND }),
      Animated.timing(slideY,  { toValue: 0, duration: 380, useNativeDriver: ND, easing: Easing.out(Easing.ease) }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      <LinearGradient
        colors={['#060B18', '#0A0F1E', '#0E1830']}
        style={StyleSheet.absoluteFill}
      />

      {/* Subtle red glow behind icon */}
      <View style={styles.glowRed} />

      <Animated.View style={[styles.card, { transform: [{ translateY: slideY }] }]}>
        {/* Icon */}
        <View style={styles.iconWrap}>
          <WifiOffIcon size={84} />
        </View>

        {/* Text */}
        <Text style={[styles.title, language === 'ar' && styles.rtl]}>{t.title}</Text>
        <Text style={[styles.body, language === 'ar' && styles.rtl]}>{t.body}</Text>

        {/* Retry button */}
        <TouchableOpacity
          style={[styles.retryBtn, isChecking && styles.retryBtnDisabled]}
          onPress={recheckConnectivity}
          disabled={isChecking}
          activeOpacity={0.75}
        >
          <LinearGradient
            colors={isChecking ? ['#374151', '#1F2937'] : ['#1D4ED8', '#4F46E5']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.retryGradient}
          >
            <Text style={styles.retryText}>
              {isChecking ? t.checking : t.retry}
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Offline mode — view local data without internet */}
        {!isChecking && (
          <TouchableOpacity
            style={styles.offlineBtn}
            onPress={enableOfflineMode}
            activeOpacity={0.7}
          >
            <Text style={[styles.offlineBtnText, language === 'ar' && styles.rtl]}>
              {t.offline}
            </Text>
          </TouchableOpacity>
        )}
      </Animated.View>

      {/* Bottom hint */}
      <Text style={styles.hint}>
        {language === 'ar'
          ? 'تحقق من إعدادات الشبكة أو Wi-Fi'
          : 'Check your Wi-Fi or mobile data settings'}
      </Text>
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems:     'center',
    justifyContent: 'center',
    zIndex:         9998,
  },
  glowRed: {
    position:        'absolute',
    width:           220,
    height:          220,
    borderRadius:    110,
    backgroundColor: 'transparent',
    shadowColor:     '#EF4444',
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.25,
    shadowRadius:    60,
    elevation:       10,
  },
  card: {
    alignItems:      'center',
    paddingHorizontal: 32,
    paddingVertical:   8,
    maxWidth:          360,
    width:             '100%',
  },
  iconWrap: {
    marginBottom: 28,
  },
  iconRing: {
    position:    'absolute',
    borderWidth: 2,
    opacity:     0.5,
  },
  iconInner: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    alignItems:      'center',
    justifyContent:  'flex-end',
    paddingBottom:   14,
  },
  wifiBar: {
    backgroundColor: '#EF4444',
    borderRadius:    2,
  },
  title: {
    color:        '#F1F5F9',
    fontSize:     20,
    fontWeight:   '700',
    textAlign:    'center',
    marginBottom: 12,
    letterSpacing: 0.3,
  },
  body: {
    color:        '#94A3B8',
    fontSize:     14,
    textAlign:    'center',
    lineHeight:   22,
    marginBottom: 36,
  },
  rtl: {
    textAlign:         'center',
    writingDirection:  'rtl',
  },
  retryBtn: {
    width:        240,
    borderRadius: 14,
    overflow:     'hidden',
    shadowColor:  '#4F46E5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius:  12,
    elevation:    8,
  },
  retryBtnDisabled: {
    shadowOpacity: 0,
    elevation:     0,
  },
  retryGradient: {
    paddingVertical:   16,
    alignItems:        'center',
    justifyContent:    'center',
  },
  retryText: {
    color:       '#FFFFFF',
    fontSize:    15,
    fontWeight:  '600',
    letterSpacing: 0.5,
  },
  offlineBtn: {
    marginTop:   14,
    paddingVertical:   10,
    paddingHorizontal: 20,
  },
  offlineBtnText: {
    color:       '#64748B',
    fontSize:    13,
    fontWeight:  '500',
    textDecorationLine: 'underline',
    textAlign:   'center',
  },
  hint: {
    position:   'absolute',
    bottom:     48,
    color:      '#475569',
    fontSize:   12,
    textAlign:  'center',
  },
});

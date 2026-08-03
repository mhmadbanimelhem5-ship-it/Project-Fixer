/**
 * OfflineBanner.tsx
 *
 * A slim bar shown at the very top of the screen when the user has chosen
 * "Offline Mode" (view-only — no internet operations).
 *
 * • Hides automatically once internet is restored (NetworkContext auto-exits).
 * • Tapping "خروج" / "Exit" forces an immediate recheck and exits offline mode.
 * • Supports Arabic / English via LanguageContext.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNetwork } from '@/contexts/NetworkContext';
import { useLanguage } from '@/contexts/LanguageContext';

const ND = Platform.OS !== 'web';

const STRINGS = {
  ar: { msg: 'وضع العرض فقط — بدون إنترنت', exit: 'إعادة الاتصال' },
  en: { msg: 'Offline Mode — view only',      exit: 'Reconnect'    },
} as const;

export function OfflineBanner() {
  const { offlineMode, recheckConnectivity, exitOfflineMode } = useNetwork();
  const { language } = useLanguage();
  const t = STRINGS[language === 'ar' ? 'ar' : 'en'];

  const slideY  = useRef(new Animated.Value(-40)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (offlineMode) {
      Animated.parallel([
        Animated.timing(slideY,  { toValue: 0, duration: 280, useNativeDriver: ND, easing: Easing.out(Easing.ease) }),
        Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: ND }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideY,  { toValue: -40, duration: 220, useNativeDriver: ND }),
        Animated.timing(opacity, { toValue: 0,   duration: 220, useNativeDriver: ND }),
      ]).start();
    }
  }, [offlineMode]);

  const handleExit = () => {
    exitOfflineMode();
    recheckConnectivity();
  };

  if (!offlineMode) return null;

  return (
    <Animated.View style={[styles.bar, { opacity, transform: [{ translateY: slideY }] }]}>
      <View style={styles.dot} />
      <Text style={[styles.msg, language === 'ar' && styles.rtl]} numberOfLines={1}>
        {t.msg}
      </Text>
      <TouchableOpacity onPress={handleExit} style={styles.exitBtn} activeOpacity={0.7}>
        <Text style={styles.exitText}>{t.exit}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position:        'absolute',
    top:             0,
    left:            0,
    right:           0,
    zIndex:          9990,
    backgroundColor: '#92400E',
    flexDirection:   'row',
    alignItems:      'center',
    paddingHorizontal: 14,
    paddingVertical:   7,
    gap:               8,
  },
  dot: {
    width:           7,
    height:          7,
    borderRadius:    4,
    backgroundColor: '#FCD34D',
    flexShrink:      0,
  },
  msg: {
    flex:       1,
    color:      '#FEF3C7',
    fontSize:   12,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  rtl: {
    textAlign: 'right',
  },
  exitBtn: {
    backgroundColor:  'rgba(255,255,255,0.15)',
    borderRadius:     6,
    paddingHorizontal: 10,
    paddingVertical:   4,
  },
  exitText: {
    color:      '#FEF3C7',
    fontSize:   11,
    fontWeight: '600',
  },
});

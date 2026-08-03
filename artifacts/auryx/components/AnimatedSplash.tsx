/**
 * AnimatedSplash.tsx
 *
 * Neon-glass intro with responsive layout:
 *
 * - Icon size = 42% of the shorter screen edge (fits all devices)
 * - Ring sizes derived from icon size so they always surround it correctly
 * - Rings rendered with position:'absolute' + zIndex 0 (background layer)
 * - Icon rendered with zIndex 10 (always on top, never clipped)
 * - No overflow:hidden anywhere so nothing is cut off
 *
 * Timeline (~2.5 s, unchanged):
 *  0 ms    — bg + icon fade-in together (200 / 250 ms)
 *  0 ms    — rings start 1.5-pulse sequence (staggered 120 ms)
 * ~1170 ms — all ring animations done
 * ~1770 ms — 600 ms hold (icon clearly visible)
 * ~2270 ms — 500 ms exit fade → onComplete
 */

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const ND = Platform.OS !== 'web';

interface Props {
  onComplete: () => void;
  /** Called when the 3.5 s safety timer fires instead of the normal animation path.
   *  Parent can use this to surface a diagnostic warning to the user. */
  onSafetyTimerFired?: () => void;
}

export function AnimatedSplash({ onComplete, onSafetyTimerFired }: Props) {
  const { width, height } = useWindowDimensions();

  // ── Responsive sizing ─────────────────────────────────────────────────────
  // Base unit: 42% of the shorter screen dimension, capped at 220 dp
  const base      = Math.min(width, height);
  const ICON_SIZE = Math.min(base * 0.42, 220);

  // Rings start small (65% of their target diameter) and expand outward.
  // Starting diameter (before pulse scale) must already be > ICON_SIZE so the
  // ring is visually "behind" the icon even at its initial scale.
  const RING1_D = ICON_SIZE * 1.72;   // outer — electric blue
  const RING2_D = ICON_SIZE * 1.44;   // middle — purple
  const RING3_D = ICON_SIZE * 1.18;   // inner  — gold

  // ── Animation values ──────────────────────────────────────────────────────
  const bgOpacity   = useRef(new Animated.Value(0)).current;
  const iconOpacity = useRef(new Animated.Value(0)).current;

  const r1o = useRef(new Animated.Value(0)).current;
  const r1s = useRef(new Animated.Value(0.65)).current;
  const r2o = useRef(new Animated.Value(0)).current;
  const r2s = useRef(new Animated.Value(0.65)).current;
  const r3o = useRef(new Animated.Value(0)).current;
  const r3s = useRef(new Animated.Value(0.65)).current;

  const exitOpacity = useRef(new Animated.Value(1)).current;

  // ── Ring pulse (1.5×): full cycle + half up ───────────────────────────────
  const pulseRing = (
    opacity: Animated.Value,
    scale:   Animated.Value,
    delay:   number,
  ) =>
    Animated.sequence([
      Animated.delay(delay),
      // Full pulse
      Animated.parallel([
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 0.92,
            duration: 280,
            useNativeDriver: ND,
            easing: Easing.out(Easing.ease),
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 370,
            useNativeDriver: ND,
            easing: Easing.in(Easing.ease),
          }),
        ]),
        Animated.timing(scale, {
          toValue: 1.55,
          duration: 650,
          useNativeDriver: ND,
          easing: Easing.out(Easing.ease),
        }),
      ]),
      // Reset for half pulse
      Animated.timing(scale, { toValue: 0.65, duration: 0, useNativeDriver: ND }),
      // Half pulse (fades up only)
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 280,
          useNativeDriver: ND,
          easing: Easing.out(Easing.ease),
        }),
        Animated.timing(scale, {
          toValue: 1.2,
          duration: 280,
          useNativeDriver: ND,
          easing: Easing.out(Easing.ease),
        }),
      ]),
    ]);

  useEffect(() => {
    // Safety-net timeout: on real Android the animation callback can fire with
    // finished=false (system interruption, background, slow Hermes init).
    // We always call onComplete after 3.5 s regardless of animation state.
    const safetyTimer = setTimeout(() => {
      onSafetyTimerFired?.();
      onComplete();
    }, 3500);

    Animated.parallel([
      Animated.timing(bgOpacity, {
        toValue: 1, duration: 200, useNativeDriver: ND,
      }),
      Animated.timing(iconOpacity, {
        toValue: 1, duration: 250, useNativeDriver: ND,
        easing: Easing.out(Easing.ease),
      }),
      pulseRing(r1o, r1s, 0),
      pulseRing(r2o, r2s, 120),
      pulseRing(r3o, r3s, 240),
    ]).start(() => {
      Animated.sequence([
        Animated.delay(600),
        Animated.timing(exitOpacity, {
          toValue: 0, duration: 500, useNativeDriver: ND,
          easing: Easing.inOut(Easing.ease),
        }),
      ]).start(() => {
        // Always call onComplete — never guard with `finished` because on
        // real Android the animation can be interrupted (finished=false)
        // which left the invisible overlay blocking ALL touch events.
        clearTimeout(safetyTimer);
        onComplete();
      });
    });

    return () => clearTimeout(safetyTimer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived ring styles (static, no StyleSheet for dynamic values) ─────────
  const makeRing = (diameter: number, color: string) => ({
    width:        diameter,
    height:       diameter,
    borderRadius: diameter / 2,
    borderColor:  color,
  });

  return (
    /*
     * Static View permanently owns pointerEvents="none" (both prop + style).
     * The native driver that animates exitOpacity runs on a separate thread and
     * cannot change pointer routing on the JS-side prop — wrapping in a static
     * View is the only 100 % reliable guard on New Architecture (Fabric).
     */
    <View style={styles.touchShield} pointerEvents="none">
    <Animated.View style={[styles.container, { opacity: exitOpacity }]}>

      {/* ── Layer 0: Background ─────────────────────────────────────────── */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: bgOpacity }]}>
        <LinearGradient
          colors={['#060B18', '#0A0F1E', '#0E142A']}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* ── Layer 1: Rings (absolute, behind icon, pointerEvents='none') ─── */}
      {/* Ring 1 — electric blue (outermost) */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          makeRing(RING1_D, '#38BDF8'),
          { opacity: r1o, transform: [{ scale: r1s }] },
        ]}
      />
      {/* Ring 2 — purple */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          makeRing(RING2_D, '#8B5CF6'),
          { opacity: r2o, transform: [{ scale: r2s }] },
        ]}
      />
      {/* Ring 3 — gold (innermost) */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          makeRing(RING3_D, '#D4AF37'),
          { opacity: r3o, transform: [{ scale: r3s }] },
        ]}
      />

      {/* ── Layer 2: Icon (above rings, zIndex ensures it's never hidden) ── */}
      <Animated.View
        style={[styles.iconWrap, { opacity: iconOpacity }]}
        pointerEvents="none"
      >
        {/* Purple glow halo behind the icon */}
        <View
          style={[
            styles.glowBehind,
            { width: ICON_SIZE * 1.05, height: ICON_SIZE * 1.05,
              borderRadius: ICON_SIZE * 0.525 },
          ]}
        />
        <Image
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          source={require('../assets/images/icon.png')}
          style={{ width: ICON_SIZE, height: ICON_SIZE }}
          resizeMode="contain"
        />
      </Animated.View>

    </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  /*
   * touchShield: static View that holds the zIndex and pointerEvents.
   * Animated.View (container) only handles visual — never pointer routing.
   */
  touchShield: {
    ...StyleSheet.absoluteFillObject,
    zIndex:        9999,
    pointerEvents: 'none',
  },
  container: {
    flex:            1,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: '#0A0F1E',
    // No overflow:hidden — nothing is clipped
  },
  ring: {
    position:    'absolute',
    alignSelf:   'center',
    borderWidth: 1.5,
    // Rings sit on layer 1, below the icon
    zIndex: 1,
  },
  iconWrap: {
    alignItems:     'center',
    justifyContent: 'center',
    // Icon layer is explicitly above rings
    zIndex: 10,
  },
  glowBehind: {
    position:        'absolute',
    backgroundColor: 'transparent',
    shadowColor:     '#8B5CF6',
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.9,
    shadowRadius:    45,
    elevation:       20,
  },
});

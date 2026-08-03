/**
 * ScreenPulse.tsx
 *
 * A zero-risk animated background tint — replaces all overlay-based
 * backgrounds (HexagonParticles, DiagonalLines) that were blocking touches
 * on real Android devices.
 *
 * How it works — purely in the background, never above buttons:
 *   Place <ScreenPulse color="…" /> as the FIRST child inside the screen's
 *   root <View>.  Because it comes first in JSX, React Native renders it
 *   BEHIND every subsequent sibling.  All content, cards, and buttons are
 *   painted on top of it — so they always receive touches first.
 *
 *   The component itself uses the "static-shield" pattern proven in the
 *   AnimatedSplash fix:
 *
 *     ┌─ View (static, pointerEvents="none" prop + style) ──────────────┐
 *     │   Never animated → touch routing is always OFF, permanently.     │
 *     │  └─ Animated.View (opacity only, useNativeDriver:true) ─────────│
 *     │       Visual pulse lives here — no interaction role whatsoever.  │
 *     └────────────────────────────────────────────────────────────────┘
 *
 * Why not color animation directly?
 *   backgroundColor cannot use useNativeDriver:true, so it runs on the
 *   JS thread and can drop frames under heavy load.  Opacity IS natively
 *   driven — it animates on the UI thread even when JS is busy, keeping
 *   the visual smooth and the main thread free for button responses.
 *
 * Usage:
 *   <ScreenPulse color="#EF4444" />   // emergency — red
 *   <ScreenPulse color="#22C55E" />   // guardians — green
 *   <ScreenPulse color="#F97316" />   // home / legacy — orange
 *   <ScreenPulse color="#3B82F6" />   // settings — blue
 *   <ScreenPulse color="#D4AF37" />   // vault — gold
 *   <ScreenPulse color="#8B5CF6" />   // lock / onboarding — purple
 */

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
} from 'react-native';

interface ScreenPulseProps {
  /** Tint colour for this screen. */
  color: string;
  /**
   * Opacity at the bright peak of the pulse.
   * Keep ≤ 0.12 for a subtle accent.  Default: 0.10.
   */
  peakOpacity?: number;
  /**
   * Opacity at the dim valley between pulses.
   * Default: 0.03.
   */
  valleyOpacity?: number;
  /**
   * Half-cycle duration in ms (dim→bright or bright→dim).
   * Default: 3000 ms → full cycle ≈ 6 s.
   */
  duration?: number;
}

const ND = Platform.OS !== 'web';

function ScreenPulseInner({
  color,
  peakOpacity   = 0.10,
  valleyOpacity = 0.03,
  duration      = 3000,
}: ScreenPulseProps) {
  const anim   = useRef(new Animated.Value(0)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    loopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue:         1,
          duration,
          useNativeDriver: ND,
          easing:          Easing.inOut(Easing.sin),
        }),
        Animated.timing(anim, {
          toValue:         0,
          duration,
          useNativeDriver: ND,
          easing:          Easing.inOut(Easing.sin),
        }),
      ]),
    );
    loopRef.current.start();
    return () => loopRef.current?.stop();
  // color / opacity / duration changes are handled by the key prop on the
  // parent — no deps needed here for the loop itself.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const opacity = anim.interpolate({
    inputRange:  [0, 1],
    outputRange: [valleyOpacity, peakOpacity],
  });

  return (
    /*
     * OUTER — plain static View.  Owns pointerEvents="none" as BOTH prop
     * (Old Architecture / bridged mode) and style (New Architecture / Fabric).
     * This view is NEVER touched by the Animated engine, so pointerEvents
     * can never be re-enabled accidentally by a native transition.
     */
    <View style={styles.shield} pointerEvents="none">
      {/*
       * INNER — Animated.View for opacity only.
       * useNativeDriver:true → animation runs on the UI thread even when
       * JS is busy handling a press, scroll, or heavy computation.
       */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: color, opacity }]}
      />
    </View>
  );
}

export const ScreenPulse = React.memo(ScreenPulseInner);
ScreenPulse.displayName = 'ScreenPulse';

const styles = StyleSheet.create({
  shield: {
    ...StyleSheet.absoluteFillObject,
    // Style-based pointerEvents — New Architecture (Fabric / RN ≥ 0.71).
    pointerEvents: 'none',
  },
});

/**
 * DiagonalLines.tsx
 *
 * Lightweight decorative background — replaces HexagonParticles.
 *
 * Touch-safety architecture (the key insight):
 *   The OUTER View is a plain, un-animated, static View with pointerEvents="none".
 *   It is NEVER touched by the Animated engine, so there is zero risk that a
 *   native-driver opacity transition could momentarily re-enable hit-testing.
 *   The INNER Animated.View carries only the visual opacity pulse — it has no
 *   interactive role at all.
 *
 *   ┌─ View (static, pointerEvents="none" prop + style) ──────────────────────┐
 *   │  └─ Animated.View (opacity only — useNativeDriver:true) ────────────────│
 *   │     └─ Svg (pointerEvents="none") ─────────────────────────────────────│
 *   │        └─ <Line> × N (static SVG elements, zero JS overhead) ──────────│
 *   └────────────────────────────────────────────────────────────────────────┘
 *
 * Performance notes:
 *   • React.memo — re-renders only when color / baseOpacity / spacing change.
 *   • useMemo    — lines array recomputed only when width/height/spacing change.
 *   • strokeLinecap="butt" — cheaper GPU path than "round".
 *   • spacing=44 — ~25 lines on a 400 px-wide screen, imperceptible vs 34px.
 *   • Easing.sin — smooth, single AnimatedValue, pure native-thread animation.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Line } from 'react-native-svg';

interface DiagonalLinesProps {
  color?: string;
  baseOpacity?: number;
  spacing?: number;
  strokeWidth?: number;
  pulse?: boolean;
}

const ND = Platform.OS !== 'web';

function DiagonalLinesInner({
  color = '#FFFFFF',
  baseOpacity = 0.07,
  spacing = 44,
  strokeWidth = 1.0,
  pulse = true,
}: DiagonalLinesProps) {
  const { width, height } = useWindowDimensions();

  // Single Animated.Value drives opacity — pure native thread, zero JS cost.
  const animVal = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    animRef.current?.stop();

    if (!pulse) {
      animVal.setValue(0);
      return;
    }

    animRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(animVal, {
          toValue: 1,
          duration: 3400,
          useNativeDriver: ND,
          easing: Easing.inOut(Easing.sin),
        }),
        Animated.timing(animVal, {
          toValue: 0,
          duration: 3400,
          useNativeDriver: ND,
          easing: Easing.inOut(Easing.sin),
        }),
      ]),
    );
    animRef.current.start();

    return () => animRef.current?.stop();
  }, [pulse]);

  const opacity = animVal.interpolate({
    inputRange:  [0, 1],
    outputRange: [baseOpacity * 0.3, baseOpacity],
  });

  // Lines memoised — only recomputed when screen dimensions or spacing change.
  const lines = useMemo(() => {
    // Lines run at 45° (\ direction).
    // Each line: top endpoint (x, -h), bottom endpoint (x + 2h, 2h).
    // Cover columns from -height to width + height to fill all four corners.
    const totalSpan = width + height;
    const count     = Math.ceil(totalSpan / spacing) + 2;
    const startX    = -height;

    return Array.from({ length: count }, (_, i) => {
      const x = startX + i * spacing;
      return (
        <Line
          key={i}
          x1={x}            y1={-height}
          x2={x + height * 2} y2={height * 2}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="butt"
        />
      );
    });
  }, [width, height, spacing, color, strokeWidth]);

  return (
    /*
     * OUTER: plain static View — owns pointerEvents="none".
     * This view is NEVER animated, so pointer-event handling is
     * rock-solid on both Old Architecture and New Architecture (Fabric).
     */
    <View style={styles.container} pointerEvents="none">
      {/*
       * INNER: Animated.View for visual opacity only.
       * Has no interactive role; touching it is impossible because
       * the parent View already swallows (discards) all touch routing.
       */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
        <Svg
          width={width}
          height={height}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          {lines}
        </Svg>
      </Animated.View>
    </View>
  );
}

export const DiagonalLines = React.memo(DiagonalLinesInner);
DiagonalLines.displayName = 'DiagonalLines';

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    // Style-based pointerEvents — belt-and-suspenders for New Architecture.
    pointerEvents: 'none',
  },
});

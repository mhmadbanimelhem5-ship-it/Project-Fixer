/**
 * ScreenGlow.tsx
 *
 * Purely STATIC background accent — zero animations, zero Animated.Values,
 * zero useEffect, zero JS runtime cost after the first render.
 *
 * Touch safety: the outer View is a hard static shield with pointerEvents="none"
 * both as a prop (Old Architecture) and in the StyleSheet (New Architecture /
 * Fabric).  Nothing here can ever intercept a button press.
 *
 * Visual technique — "software glow" without blur modules:
 *   Four concentric circles with decreasing radius and increasing opacity
 *   simulate a light-falloff glow.  A faint Feather icon sits at the
 *   centre so each screen has a visual identity without extra libraries.
 *
 *   Rings (outermost → innermost):
 *     ○ 320 dp  α 0.04   (barely-there ambient)
 *     ○ 230 dp  α 0.06
 *     ○ 150 dp  α 0.09
 *     ○  90 dp  α 0.13   (core glow)
 *     ○ icon    opacity 0.18
 *
 * Placement: lower-centre of screen (paddingBottom 100 dp) so the glow
 * sits below the main content area in typical tab-screen layouts.
 *
 * Usage (place as first child in screen root View):
 *   <ScreenGlow color="#EF4444" icon="zap"      />  // emergency
 *   <ScreenGlow color="#22C55E" icon="shield"   />  // guardians
 *   <ScreenGlow color="#F97316" icon="layers"   />  // home / digital legacy
 *   <ScreenGlow color="#3B82F6" icon="settings" />  // settings
 *   <ScreenGlow color="#D4AF37" icon="lock"     />  // vault
 *   <ScreenGlow color="#8B5CF6" icon="key"      />  // lock screen
 *   <ScreenGlow color="#8B5CF6" icon="user"     />  // onboarding
 *   <ScreenGlow color="#D4AF37" icon="inbox"    />  // received vault
 *   <ScreenGlow color="#F97316" icon="clock"    />  // legacy transfer
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

type FeatherIconName = React.ComponentProps<typeof Feather>['name'];

interface ScreenGlowProps {
  /** Accent colour — drives both circles and icon tint. */
  color: string;
  /** Feather icon name that represents the screen's identity. */
  icon: FeatherIconName;
  /** Icon render size in dp.  Default: 68. */
  iconSize?: number;
}

/** Parse a 6-digit hex colour and return an rgba() string with the given alpha. */
function rgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function ScreenGlowInner({ color, icon, iconSize = 68 }: ScreenGlowProps) {
  return (
    /*
     * STATIC outer View — owns pointerEvents="none" permanently.
     * Never touched by any animation engine; touch routing is always OFF.
     */
    <View style={styles.shield} pointerEvents="none">
      {/*
       * Glow group — centred in the lower portion of the screen.
       * All four rings are absolutely positioned inside this container,
       * perfectly centred thanks to the container's alignItems/justifyContent.
       */}
      <View style={styles.glowGroup}>
        {/* Ring 4 — outermost, barely visible ambient */}
        <View style={[styles.ring, { width: 320, height: 320, borderRadius: 160, backgroundColor: rgba(color, 0.04) }]} />
        {/* Ring 3 */}
        <View style={[styles.ring, { width: 230, height: 230, borderRadius: 115, backgroundColor: rgba(color, 0.06) }]} />
        {/* Ring 2 */}
        <View style={[styles.ring, { width: 150, height: 150, borderRadius: 75,  backgroundColor: rgba(color, 0.09) }]} />
        {/* Ring 1 — core glow */}
        <View style={[styles.ring, { width: 90,  height: 90,  borderRadius: 45,  backgroundColor: rgba(color, 0.13) }]} />
        {/* Identity icon — above rings, still within the shield */}
        <Feather name={icon} size={iconSize} color={color} style={styles.icon} />
      </View>
    </View>
  );
}

export const ScreenGlow = React.memo(ScreenGlowInner);
ScreenGlow.displayName = 'ScreenGlow';

const styles = StyleSheet.create({
  shield: {
    ...StyleSheet.absoluteFillObject,
    // style-based pointerEvents — New Architecture (Fabric / RN ≥ 0.71).
    pointerEvents: 'none',
    alignItems:     'center',
    justifyContent: 'flex-end',
    paddingBottom:  100,          // sits below scrollable content / above tab bar
  },
  glowGroup: {
    width:           320,
    height:          320,
    alignItems:      'center',
    justifyContent:  'center',
  },
  ring: {
    position: 'absolute',
  },
  icon: {
    opacity: 0.18,
  },
});

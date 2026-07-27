import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from '@/contexts/ThemeContext';

interface NeonCircleProps {
  percentage: number;
  size?: number;
  label?: string;
  sublabel?: string;
  /** Falls back to theme gold when omitted */
  color?: string;
}

export function NeonCircle({ percentage, size = 180, label, sublabel, color }: NeonCircleProps) {
  const { colors: c, isDark } = useTheme();
  const activeColor = color ?? c.gold;
  const pulse = useRef(new Animated.Value(0.6)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    loopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.6, duration: 2000, useNativeDriver: true }),
      ])
    );
    loopRef.current.start();
    return () => loopRef.current?.stop();
  }, [pulse]);

  const strokeWidth = size * 0.045;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;
  const cx = size / 2;
  const cy = size / 2;

  const trackStroke = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
  const innerFill  = isDark ? 'rgba(10,15,30,0.7)' : 'rgba(244,246,251,0.7)';
  const innerStroke = isDark ? 'rgba(212,175,55,0.15)' : 'rgba(184,150,12,0.15)';

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Outer glow ring — pointerEvents="none" so the native-driven pulse never intercepts touch */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: pulse, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }]}>
        <View style={{
          width: size * 0.96,
          height: size * 0.96,
          borderRadius: size * 0.48,
          borderWidth: 1,
          borderColor: activeColor,
          opacity: 0.3,
        }} />
      </Animated.View>

      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="neonGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={activeColor} stopOpacity="1" />
            <Stop offset="1" stopColor={c.purple} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        {/* Background track */}
        <Circle
          cx={cx} cy={cy} r={radius}
          stroke={trackStroke}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress arc */}
        <Circle
          cx={cx} cy={cy} r={radius}
          stroke="url(#neonGrad)"
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${cx},${cy}`}
        />
        {/* Inner decorative circle */}
        <Circle
          cx={cx} cy={cy} r={radius * 0.80}
          stroke={innerStroke}
          strokeWidth={1}
          fill={innerFill}
        />
      </Svg>

      <View style={styles.content}>
        {label && <Text style={[styles.label, { color: activeColor }]}>{label}</Text>}
        {sublabel && <Text style={[styles.sublabel, { color: c.textSecondary }]}>{sublabel}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
  },
  label: {
    fontSize: 28,
    fontWeight: '700',
    fontFamily: 'Poppins_700Bold',
    letterSpacing: 1,
  },
  sublabel: {
    fontSize: 11,
    fontFamily: 'Poppins_400Regular',
    marginTop: 2,
    letterSpacing: 0.5,
  },
});

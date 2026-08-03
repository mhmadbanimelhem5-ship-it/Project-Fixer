import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  variant?: 'default' | 'gold' | 'purple' | 'blue' | 'red';
  padding?: number;
}

export function GlassCard({ children, style, variant = 'default', padding = 16 }: GlassCardProps) {
  const { colors: c } = useTheme();

  const borderColor = {
    default: c.glassBorder,
    gold: 'rgba(212,175,55,0.30)',
    purple: 'rgba(139,92,246,0.30)',
    blue: 'rgba(59,130,246,0.30)',
    red: 'rgba(239,68,68,0.30)',
  }[variant];

  const bgColor = {
    default: c.glass,
    gold: 'rgba(212,175,55,0.08)',
    purple: 'rgba(139,92,246,0.08)',
    blue: 'rgba(59,130,246,0.08)',
    red: 'rgba(239,68,68,0.08)',
  }[variant];

  return (
    <View
      style={[
        styles.card,
        { borderColor, backgroundColor: bgColor, padding },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
});

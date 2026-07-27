import React, { useCallback, useMemo } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '@/contexts/ThemeContext';

interface LockPadProps {
  value: string;
  onChange: (val: string) => void;
  maxLength?: number;
  /** Called with the COMPLETE pin string once maxLength is reached */
  onSubmit?: (completedPin: string) => void;
}

const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'del'],
];

export function LockPad({ value, onChange, maxLength = 6, onSubmit }: LockPadProps) {
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);

  const handlePress = useCallback((key: string) => {
    if (key === '') return;
    if (Platform.OS !== 'web') {
      try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    }
    if (key === 'del') {
      onChange(value.slice(0, -1));
    } else {
      if (value.length < maxLength) {
        const newVal = value + key;
        onChange(newVal);
        // Pass the complete value directly — avoids stale closure on the parent
        if (newVal.length === maxLength && onSubmit) {
          setTimeout(() => onSubmit(newVal), 150);
        }
      }
    }
  }, [value, onChange, maxLength, onSubmit]);

  return (
    <View style={styles.container}>
      {/* PIN dots — always LTR so filled dots grow left→right on any locale */}
      <View style={styles.dotsRow}>
        {Array.from({ length: maxLength }, (_, i) => (
          <View
            key={i}
            style={[styles.dot, i < value.length ? styles.dotFilled : styles.dotEmpty]}
          />
        ))}
      </View>

      {/* Number pad — direction:'ltr' keeps 1-2-3 left-to-right on RTL locales */}
      <View style={styles.pad}>
        {KEYS.map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map((key, ki) => (
              <TouchableOpacity
                key={ki}
                style={[
                  styles.key,
                  key === '' && styles.keyInvisible,
                  key === 'del' && styles.keyDel,
                ]}
                onPress={() => handlePress(key)}
                activeOpacity={key === '' ? 1 : 0.55}
                disabled={key === ''}
              >
                {key === 'del' ? (
                  <Feather name="delete" size={22} color={c.textSecondary} />
                ) : key !== '' ? (
                  <Text style={styles.keyText}>{key}</Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { alignItems: 'center', width: '100%' },
  dotsRow: { flexDirection: 'row', direction: 'ltr', gap: 16, marginBottom: 32 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  dotEmpty: { backgroundColor: 'transparent', borderWidth: 2, borderColor: c.glassBorder },
  dotFilled: {
    backgroundColor: c.gold,
    shadowColor: c.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 6,
  },
  // direction:'ltr' ensures the ENTIRE pad is laid out LTR on RTL locales
  // so keys always render 1-2-3 (left to right), never 3-2-1
  pad: { gap: 12, width: '100%', direction: 'ltr' },
  row: { flexDirection: 'row', justifyContent: 'center', gap: 20, direction: 'ltr' },
  key: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: c.glass,
    borderWidth: 1, borderColor: c.glassBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  keyInvisible: { backgroundColor: 'transparent', borderColor: 'transparent' },
  keyDel: { backgroundColor: c.glassMedium, borderColor: c.border },
  keyText: {
    fontSize: 26, fontWeight: '300', color: c.text,
    fontFamily: 'Poppins_400Regular',
    writingDirection: 'ltr',
    textAlign: 'center',
  },
});

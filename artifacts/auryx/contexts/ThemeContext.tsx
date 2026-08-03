/**
 * ThemeContext.tsx
 *
 * Manages the app-wide color theme (dark / light / system).
 * • Persists the user's choice in SecureStore (key: auryx_theme_mode).
 * • Falls back to the device color scheme when mode === 'system'.
 * • Defaults to 'system' on first launch.
 * • Exposes `colors` — the active ThemeColors palette — ready to use
 *   directly in components and StyleSheet factories.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import rawColors, { ThemeColors } from '@/constants/colors';

const STORE_KEY = 'auryx_theme_mode';

export type ThemeMode = 'dark' | 'light' | 'system';

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  isDark: boolean;
  colors: ThemeColors;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  setMode: () => {},
  isDark: true,
  colors: rawColors.dark,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [loaded, setLoaded] = useState(false);

  // Load persisted preference once on mount
  useEffect(() => {
    if (Platform.OS === 'web') { setLoaded(true); return; }
    SecureStore.getItemAsync(STORE_KEY)
      .then((stored) => {
        if (stored === 'dark' || stored === 'light' || stored === 'system') {
          setModeState(stored);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    if (Platform.OS !== 'web') {
      SecureStore.setItemAsync(STORE_KEY, m).catch(() => {});
    }
  }, []);

  // Resolve actual dark/light: 'system' defers to device, null device → dark
  const isDark =
    mode === 'dark' ||
    (mode === 'system' && (systemScheme === 'dark' || systemScheme === null));

  const colors = isDark ? rawColors.dark : rawColors.light;

  // Memoize the context value so consumers only re-render when mode or
  // isDark actually changes — not on every ThemeProvider render cycle.
  const value = useMemo<ThemeContextValue>(
    () => ({ mode, setMode, isDark, colors }),
    [mode, setMode, isDark, colors],
  );

  // Don't render children until we've loaded the preference from storage,
  // so screens never flash the wrong theme on launch.
  if (!loaded) return null;

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
export type { ThemeColors };

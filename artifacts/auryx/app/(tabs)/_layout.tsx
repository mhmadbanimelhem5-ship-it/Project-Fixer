import { Tabs, useRouter } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/contexts/ThemeContext';

// React.memo: prevents re-render when parent tab layout re-renders
const CenterButton = React.memo(function CenterButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity
      style={tabStyles.centerBtn}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <LinearGradient
        colors={['#EF4444', '#B91C1C']}
        style={tabStyles.centerBtnGrad}
      >
        <Feather name="zap" size={22} color="#fff" />
      </LinearGradient>
    </TouchableOpacity>
  );
});

export default function TabLayout() {
  const { t } = useLanguage();
  const { colors: c, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const tabBarHeight = 60 + (isWeb ? 34 : insets.bottom);

  // Stable callback — CenterButton is memo'd so this prevents unnecessary re-renders
  const handleEmergencyPress = React.useCallback(
    () => router.push('/emergency'),
    [router],
  );

  const tabBg = isDark ? 'rgba(10,15,30,0.98)' : 'rgba(244,246,251,0.98)';
  const tabBgSolid = isDark ? 'rgba(10,15,30,0.95)' : 'rgba(244,246,251,0.95)';
  const inactiveTint = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(10,15,30,0.35)';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.gold,
        tabBarInactiveTintColor: inactiveTint,
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: 10,
          fontFamily: 'Poppins_400Regular',
          marginBottom: 4,
        },
        tabBarStyle: {
          position: 'absolute',
          height: tabBarHeight,
          backgroundColor: isIOS ? 'transparent' : tabBgSolid,
          borderTopWidth: 1,
          borderTopColor: isDark ? 'rgba(212,175,55,0.15)' : 'rgba(184,150,12,0.15)',
          paddingBottom: isWeb ? 34 : insets.bottom,
          paddingTop: 4,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={90} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: tabBg }]} />
          ),
        // freezeOnBlur: suspends inactive tab screens so they stop re-rendering
        // and drops their frame buffer — significant memory + CPU saving.
        freezeOnBlur: true,
        // lazy: defers rendering a screen until the user first visits it.
        lazy: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.overview'),
          tabBarIcon: ({ color }) => <Feather name="home" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="vault"
        options={{
          title: t('tabs.vault'),
          tabBarIcon: ({ color }) => <Feather name="shield" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="emergency"
        options={{
          title: '',
          tabBarIcon: () => null,
          tabBarButton: () => <CenterButton onPress={handleEmergencyPress} />,
        }}
      />
      <Tabs.Screen
        name="guardians"
        options={{
          title: t('tabs.guardians'),
          tabBarIcon: ({ color }) => <Feather name="users" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          tabBarIcon: ({ color }) => <Feather name="settings" size={20} color={color} />,
        }}
      />
    </Tabs>
  );
}

const tabStyles = StyleSheet.create({
  centerBtn: {
    top: -20,
    alignSelf: 'center',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 8,
  },
  centerBtnGrad: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(239,68,68,0.4)',
  },
});

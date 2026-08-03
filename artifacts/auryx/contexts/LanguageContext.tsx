import React, { createContext, useContext, useEffect, useState } from 'react';
import { I18nManager, Platform } from 'react-native';
import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import * as SecureStore from 'expo-secure-store';

import en from '@/locales/en.json';
import ar from '@/locales/ar.json';

const LANGUAGE_KEY = 'auryx_language';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  compatibilityJSON: 'v4',
});

type Language = 'en' | 'ar';

interface LanguageContextType {
  language: Language;
  isRTL: boolean;
  setLanguage: (lang: Language) => void;
  t: ReturnType<typeof useTranslation>['t'];
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  isRTL: false,
  setLanguage: () => {},
  t: ((key: string) => key) as unknown as ReturnType<typeof useTranslation>['t'],
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');
  const { t } = useTranslation();

  useEffect(() => {
    const init = async () => {
      try {
        let stored: string | null = null;
        if (Platform.OS !== 'web') {
          stored = await SecureStore.getItemAsync(LANGUAGE_KEY);
        } else {
          stored = localStorage.getItem(LANGUAGE_KEY);
        }
        if (stored === 'ar' || stored === 'en') {
          await applyLanguage(stored as Language);
        } else {
          const locale = Localization.getLocales()[0]?.languageCode ?? 'en';
          const lang: Language = locale === 'ar' ? 'ar' : 'en';
          await applyLanguage(lang);
        }
      } catch {
        await applyLanguage('en');
      }
    };
    init();
  }, []);

  const applyLanguage = async (lang: Language) => {
    await i18n.changeLanguage(lang);
    setLanguageState(lang);
    if (Platform.OS !== 'web') {
      // Keep the UI layout permanently LTR regardless of locale.
      // Arabic text direction is handled per-component via writingDirection/textAlign.
      // Calling forceRTL(true) would flip the entire layout (including the number
      // pad) after the next app restart, which causes reversed digits on Arabic
      // locale APK builds.
      I18nManager.allowRTL(false);
      I18nManager.forceRTL(false);
    }
    try {
      if (Platform.OS !== 'web') {
        await SecureStore.setItemAsync(LANGUAGE_KEY, lang);
      } else {
        localStorage.setItem(LANGUAGE_KEY, lang);
      }
    } catch {}
  };

  const setLanguage = async (lang: Language) => {
    await applyLanguage(lang);
  };

  return (
    <LanguageContext.Provider
      value={{ language, isRTL: language === 'ar', setLanguage, t }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);

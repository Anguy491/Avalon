import type { Locale } from 'expo-localization';

export type AppLocale = 'zh-CN' | 'en';

type LocalePreference = Pick<Locale, 'languageCode'>;

export function resolveAppLocale(
  preferences: readonly LocalePreference[],
): AppLocale {
  for (const preference of preferences) {
    if (preference.languageCode === 'zh') return 'zh-CN';
    if (preference.languageCode === 'en') return 'en';
  }
  return 'en';
}

import { getLocales } from 'expo-localization';
import { I18n, type TranslateOptions } from 'i18n-js';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';

import { resolveAppLocale, type AppLocale } from './locale';
import { enMessages, zhCNMessages, type MessageKey } from './messages';

export interface MessageDescriptor {
  readonly key: MessageKey;
  readonly options?: Readonly<Record<string, string | number>>;
}

export type Translate = (key: MessageKey, options?: TranslateOptions) => string;

interface LocalizationContextValue {
  readonly locale: AppLocale;
  readonly t: Translate;
}

const LocalizationContext = createContext<LocalizationContextValue | null>(
  null,
);

export function translateDescriptor(
  t: Translate,
  descriptor: MessageDescriptor,
): string {
  return t(descriptor.key, descriptor.options);
}

function createI18n(locale: AppLocale) {
  return new I18n(
    { en: enMessages, 'zh-CN': zhCNMessages },
    {
      defaultLocale: 'en',
      defaultSeparator: '/',
      enableFallback: false,
      locale,
      missingBehavior: 'error',
    },
  );
}

export function LocalizationProvider({ children }: PropsWithChildren) {
  const [locale, setLocale] = useState<AppLocale>(() =>
    resolveAppLocale(getLocales()),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setLocale(resolveAppLocale(getLocales()));
    });
    return () => {
      subscription.remove();
    };
  }, []);

  const i18n = useMemo(() => createI18n(locale), [locale]);
  const t = useCallback<Translate>(
    (key, options) => i18n.t(key, options),
    [i18n],
  );
  const value = useMemo(() => ({ locale, t }), [locale, t]);

  return (
    <LocalizationContext.Provider value={value}>
      {children}
    </LocalizationContext.Provider>
  );
}

export function useI18n(): LocalizationContextValue {
  const value = use(LocalizationContext);
  if (value === null) {
    throw new Error('useI18n must be used inside LocalizationProvider');
  }
  return value;
}

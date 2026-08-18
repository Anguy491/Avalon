import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import { sanitizeSentryEvent } from './sentry-sanitizer';

export function initializeSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  Sentry.init({
    dsn,
    enabled: dsn !== undefined && dsn.length > 0,
    sendDefaultPii: false,
    attachScreenshot: false,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    enableAutoSessionTracking: true,
    enableNdkScopeSync: false,
    beforeBreadcrumb: () => null,
    beforeSend: (event) =>
      sanitizeSentryEvent(
        event as unknown as Parameters<typeof sanitizeSentryEvent>[0],
      ) as unknown as typeof event,
    release: Constants.expoConfig?.version,
    dist:
      Constants.expoConfig?.ios?.buildNumber ??
      String(Constants.expoConfig?.android?.versionCode ?? ''),
  });
}

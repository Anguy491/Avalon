import type { ConfigContext, ExpoConfig } from 'expo/config';

const PLACEHOLDER_BUNDLE_ID = 'com.example.avalon.dev';
const PLACEHOLDER_JOIN_HOST = 'join.example.invalid';
const DEPLOYMENT_ENV = process.env.EXPO_PUBLIC_DEPLOYMENT_ENV ?? 'development';
const APP_NAME = process.env.EXPO_PUBLIC_APP_NAME ?? '曼波阿瓦隆';
const APP_SLUG = process.env.EXPO_PUBLIC_APP_SLUG ?? 'anguy-avalon';
const APP_SCHEME = process.env.EXPO_PUBLIC_APP_SCHEME ?? 'anguyavalon';
const BUNDLE_ID = process.env.EXPO_PUBLIC_BUNDLE_ID ?? 'dev.anguy.avalon';
const JOIN_HOST = process.env.EXPO_PUBLIC_JOIN_HOST ?? 'avalon.anguy.dev';
// Associated Domains is an Apple-signed capability. Keep it opt-in so a local
// Simulator development build does not require a signing identity.
const ENABLE_IOS_ASSOCIATED_DOMAINS =
  process.env.EXPO_ENABLE_IOS_ASSOCIATED_DOMAINS === '1';
const APP_LINKS_VERIFIED = process.env.EXPO_APP_LINKS_VERIFIED === '1';

function isSecureUrl(value: string | undefined, protocol: 'https:' | 'wss:') {
  try {
    const parsed = new URL(value ?? '');
    return (
      parsed.protocol === protocol && !parsed.hostname.endsWith('.invalid')
    );
  } catch {
    return false;
  }
}

if (!['development', 'preview', 'production'].includes(DEPLOYMENT_ENV)) {
  throw new Error(
    'EXPO_PUBLIC_DEPLOYMENT_ENV must be development/preview/production.',
  );
}

if (ENABLE_IOS_ASSOCIATED_DOMAINS && JOIN_HOST === PLACEHOLDER_JOIN_HOST) {
  throw new Error(
    'EXPO_PUBLIC_JOIN_HOST must be a real HTTPS host when EXPO_ENABLE_IOS_ASSOCIATED_DOMAINS=1.',
  );
}

if (
  DEPLOYMENT_ENV !== 'development' &&
  (APP_NAME.includes('开发占位') ||
    APP_SLUG === 'avalon-dev' ||
    APP_SCHEME === 'avalon-dev' ||
    BUNDLE_ID === PLACEHOLDER_BUNDLE_ID ||
    JOIN_HOST === PLACEHOLDER_JOIN_HOST)
) {
  throw new Error('Preview/Production app identity cannot use placeholders.');
}

if (
  DEPLOYMENT_ENV !== 'development' &&
  (!isSecureUrl(process.env.EXPO_PUBLIC_API_URL, 'https:') ||
    !isSecureUrl(process.env.REALTIME_PUBLIC_URL, 'wss:') ||
    !ENABLE_IOS_ASSOCIATED_DOMAINS ||
    !APP_LINKS_VERIFIED ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(
      process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '',
    ) ||
    process.env.SENTRY_REVIEWED !== '1' ||
    !/^https:\/\/[^@]+@[^/]*\.ingest\.de\.sentry\.io\//u.test(
      process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
    ))
) {
  throw new Error(
    'Preview/Production requires HTTPS/WSS, verified App Links, EAS project and reviewed Sentry DE configuration.',
  );
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: APP_NAME,
  slug: APP_SLUG,
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: APP_SCHEME,
  userInterfaceStyle: 'automatic',
  runtimeVersion: { policy: 'appVersion' },
  ios: {
    bundleIdentifier: BUNDLE_ID,
    icon: './assets/expo.icon',
    supportsTablet: true,
    ...(ENABLE_IOS_ASSOCIATED_DOMAINS
      ? { associatedDomains: [`applinks:${JOIN_HOST}`] }
      : {}),
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#EFEAE0',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: APP_LINKS_VERIFIED,
        data: [
          {
            scheme: 'https',
            host: JOIN_HOST,
            pathPrefix: '/join/',
          },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  web: {
    output: 'single',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    '@sentry/react-native/expo',
    [
      'expo-camera',
      {
        cameraPermission: '用于扫描公开房间二维码；不会采集照片、视频或音频。',
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#171A22',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
  ],
  extra: {
    deploymentEnvironment: DEPLOYMENT_ENV,
    eas: {
      projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
    },
  },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
});

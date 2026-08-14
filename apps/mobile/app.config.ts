import type { ConfigContext, ExpoConfig } from 'expo/config';

const PLACEHOLDER_BUNDLE_ID = 'com.example.avalon.dev';
const PLACEHOLDER_JOIN_HOST = 'join.example.invalid';
const JOIN_HOST = process.env.EXPO_PUBLIC_JOIN_HOST ?? PLACEHOLDER_JOIN_HOST;
// Associated Domains is an Apple-signed capability. Keep it opt-in so a local
// Simulator development build does not require a signing identity.
const ENABLE_IOS_ASSOCIATED_DOMAINS =
  process.env.EXPO_ENABLE_IOS_ASSOCIATED_DOMAINS === '1';

if (ENABLE_IOS_ASSOCIATED_DOMAINS && JOIN_HOST === PLACEHOLDER_JOIN_HOST) {
  throw new Error(
    'EXPO_PUBLIC_JOIN_HOST must be a real HTTPS host when EXPO_ENABLE_IOS_ASSOCIATED_DOMAINS=1.',
  );
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Avalon（开发占位）',
  slug: 'avalon-dev',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'avalon-dev',
  userInterfaceStyle: 'automatic',
  runtimeVersion: { policy: 'appVersion' },
  ios: {
    bundleIdentifier: PLACEHOLDER_BUNDLE_ID,
    icon: './assets/expo.icon',
    supportsTablet: true,
    ...(ENABLE_IOS_ASSOCIATED_DOMAINS
      ? { associatedDomains: [`applinks:${JOIN_HOST}`] }
      : {}),
  },
  android: {
    package: PLACEHOLDER_BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#EFEAE0',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: false,
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
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
});

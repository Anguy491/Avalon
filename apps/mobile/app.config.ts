import type { ConfigContext, ExpoConfig } from 'expo/config';

const PLACEHOLDER_BUNDLE_ID = 'com.example.avalon.dev';

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
  },
  android: {
    package: PLACEHOLDER_BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#EFEAE0',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
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

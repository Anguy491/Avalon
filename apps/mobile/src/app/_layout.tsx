import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';

import { PublicDraftProvider } from '@/session/public-draft-provider';
import { HostAudioControl } from '@/audio/host-audio-control';
import {
  LocalizationProvider,
  useI18n,
} from '@/localization/localization-provider';
import { initializeSentry } from '@/observability/sentry';
import { AppPrivacyShield } from '@/privacy/app-privacy-shield';
import { HostPauseControl } from '@/session/host-pause-control';
import { SessionProvider } from '@/session/session-provider';
import { SessionStatusLayer } from '@/session/session-status-layer';
import { useAppTheme } from '@/theme/use-app-theme';

initializeSentry();

function RootNavigator() {
  const { color, isDark } = useAppTheme();
  const { t } = useI18n();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: color.surface.public },
          headerStyle: { backgroundColor: color.surface.public },
          headerTintColor: color.text.primary,
          headerBackButtonDisplayMode: 'minimal',
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="(public)" options={{ headerShown: false }} />
        <Stack.Screen name="(room)" options={{ headerShown: false }} />
        <Stack.Screen name="(game)" options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" options={{ title: t('navNotFound') }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <LocalizationProvider>
      <QueryClientProvider client={queryClient}>
        <PublicDraftProvider>
          <SessionProvider>
            <AppPrivacyShield>
              <RootNavigator />
              <HostPauseControl />
              <HostAudioControl />
              <SessionStatusLayer />
            </AppPrivacyShield>
          </SessionProvider>
        </PublicDraftProvider>
      </QueryClientProvider>
    </LocalizationProvider>
  );
}

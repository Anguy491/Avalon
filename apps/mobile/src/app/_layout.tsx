import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';

import { PublicDraftProvider } from '@/session/public-draft-provider';
import { HostPauseControl } from '@/session/host-pause-control';
import { SessionProvider } from '@/session/session-provider';
import { SessionStatusLayer } from '@/session/session-status-layer';
import { useAppTheme } from '@/theme/use-app-theme';

function RootNavigator() {
  const { color, isDark } = useAppTheme();
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
        <Stack.Screen name="+not-found" options={{ title: '页面不存在' }} />
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
    <QueryClientProvider client={queryClient}>
      <PublicDraftProvider>
        <SessionProvider>
          <RootNavigator />
          <HostPauseControl />
          <SessionStatusLayer />
        </SessionProvider>
      </PublicDraftProvider>
    </QueryClientProvider>
  );
}

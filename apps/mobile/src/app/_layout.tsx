import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';

import { color } from '@/theme/tokens';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: color.surface.public },
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

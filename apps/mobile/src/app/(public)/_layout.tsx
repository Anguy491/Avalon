import { Stack } from 'expo-router/stack';

import { useAppTheme } from '@/theme/use-app-theme';

export default function PublicLayout() {
  const { color } = useAppTheme();
  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: color.surface.public },
        headerTintColor: color.text.primary,
        contentStyle: { backgroundColor: color.surface.public },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Avalon' }} />
      <Stack.Screen name="create" options={{ title: '创建房间' }} />
      <Stack.Screen name="join/index" options={{ title: '加入房间' }} />
      <Stack.Screen name="join/[roomCode]" options={{ title: '加入房间' }} />
      <Stack.Screen name="scan" options={{ title: '扫描二维码' }} />
    </Stack>
  );
}

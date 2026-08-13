import { Stack } from 'expo-router/stack';

export default function PublicLayout() {
  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Avalon' }} />
      <Stack.Screen name="create" options={{ title: '创建房间' }} />
      <Stack.Screen name="join" options={{ title: '加入房间' }} />
      <Stack.Screen name="scan" options={{ title: '扫描二维码' }} />
    </Stack>
  );
}

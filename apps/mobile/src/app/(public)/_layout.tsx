import { Stack } from 'expo-router/stack';

import { useI18n } from '@/localization/localization-provider';
import { useAppTheme } from '@/theme/use-app-theme';

export default function PublicLayout() {
  const { color } = useAppTheme();
  const { t } = useI18n();
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
      <Stack.Screen name="index" options={{ title: t('commonAvalon') }} />
      <Stack.Screen name="create" options={{ title: t('navCreateRoom') }} />
      <Stack.Screen name="join/index" options={{ title: t('navJoinRoom') }} />
      <Stack.Screen
        name="join/[roomCode]"
        options={{ title: t('navJoinRoom') }}
      />
      <Stack.Screen name="scan" options={{ title: t('navScanQr') }} />
    </Stack>
  );
}

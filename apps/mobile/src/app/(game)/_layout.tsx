import { Stack } from 'expo-router/stack';

import { useAppTheme } from '@/theme/use-app-theme';

export default function GameLayout() {
  const { color } = useAppTheme();
  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: 'minimal',
        headerStyle: { backgroundColor: color.surface.public },
        headerTintColor: color.text.primary,
        contentStyle: { backgroundColor: color.surface.public },
      }}
    />
  );
}

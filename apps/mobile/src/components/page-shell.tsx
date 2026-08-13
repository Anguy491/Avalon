import type { PropsWithChildren } from 'react';
import { ScrollView, type StyleProp, type ViewStyle } from 'react-native';

import { spacing } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

interface PageShellProps extends PropsWithChildren {
  readonly contentStyle?: StyleProp<ViewStyle>;
}

export function PageShell({ children, contentStyle }: PageShellProps) {
  const { color } = useAppTheme();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[
        {
          flexGrow: 1,
          gap: spacing.lg,
          padding: spacing.lg,
          backgroundColor: color.surface.public,
        },
        contentStyle,
      ]}
    >
      {children}
    </ScrollView>
  );
}

import type { PropsWithChildren } from 'react';
import { ScrollView, type StyleProp, type ViewStyle } from 'react-native';

import { useSession } from '@/session/session-provider';
import { spacing } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

interface PageShellProps extends PropsWithChildren {
  readonly contentStyle?: StyleProp<ViewStyle>;
}

export function PageShell({ children, contentStyle }: PageShellProps) {
  const { color } = useAppTheme();
  const session = useSession();
  const audioCueVisible =
    session.roomView?.public.currentAudioCue !== null &&
    session.roomView?.public.currentAudioCue !== undefined;
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[
        {
          flexGrow: 1,
          gap: spacing.lg,
          padding: spacing.lg,
          paddingBottom: audioCueVisible ? 240 : spacing.lg,
          backgroundColor: color.surface.public,
        },
        contentStyle,
      ]}
    >
      {children}
    </ScrollView>
  );
}

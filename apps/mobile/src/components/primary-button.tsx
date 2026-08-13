import { Pressable, Text } from 'react-native';

import { spacing, touchTarget, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

interface PrimaryButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  accessibilityHint,
  testID,
}: PrimaryButtonProps) {
  const { color } = useAppTheme();
  const unavailable = disabled || busy;
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={busy ? `${label}，正在处理` : label}
      accessibilityRole="button"
      accessibilityState={{ disabled: unavailable, busy }}
      disabled={unavailable}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: touchTarget.minimum,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        borderRadius: 16,
        borderCurve: 'continuous',
        backgroundColor: unavailable
          ? color.action.disabled
          : color.action.primary,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Text
        selectable
        style={{
          color: color.text.inverse,
          fontSize: typography.body,
          fontWeight: '800',
        }}
      >
        {busy ? '正在处理…' : label}
      </Text>
    </Pressable>
  );
}

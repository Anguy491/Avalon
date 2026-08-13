import { Text, TextInput, View, type TextInputProps } from 'react-native';

import { spacing, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

interface FormFieldProps extends TextInputProps {
  readonly label: string;
  readonly error?: string | undefined;
}

export function FormField({
  label,
  error,
  style,
  ...inputProps
}: FormFieldProps) {
  const { color } = useAppTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text
        selectable
        style={{
          color: color.text.primary,
          fontSize: typography.body,
          fontWeight: '700',
        }}
      >
        {label}
      </Text>
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        aria-invalid={error !== undefined}
        placeholderTextColor={color.text.secondary}
        style={[
          {
            minHeight: 52,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            borderWidth: 2,
            borderColor:
              error === undefined ? color.text.secondary : color.result.failure,
            borderRadius: 14,
            borderCurve: 'continuous',
            backgroundColor: color.surface.card,
            color: color.text.primary,
            fontSize: typography.body,
          },
          style,
        ]}
      />
      {error === undefined ? null : (
        <Text
          selectable
          accessibilityLiveRegion="polite"
          style={{
            color: color.result.failure,
            fontSize: typography.supporting,
          }}
        >
          {error}
        </Text>
      )}
    </View>
  );
}

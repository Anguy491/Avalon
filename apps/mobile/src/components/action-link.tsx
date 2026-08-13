import { Link, type Href } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { color, spacing, touchTarget, typography } from '@/theme/tokens';

interface ActionLinkProps {
  readonly href: Href;
  readonly label: string;
  readonly description: string;
  readonly primary?: boolean;
}

export function ActionLink({
  href,
  label,
  description,
  primary = false,
}: ActionLinkProps) {
  const foreground = primary ? color.text.inverse : color.text.primary;

  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityHint={description}
        accessibilityLabel={label}
        accessibilityRole="button"
        style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
      >
        <View
          style={{
            minHeight: touchTarget.minimum,
            gap: spacing.xs,
            justifyContent: 'center',
            padding: spacing.md,
            borderRadius: 16,
            borderCurve: 'continuous',
            backgroundColor: primary
              ? color.action.primary
              : color.surface.card,
            borderColor: primary ? color.action.primary : '#D8D2C5',
            borderWidth: 1,
          }}
        >
          <Text
            style={{
              color: foreground,
              fontSize: typography.body,
              fontWeight: '700',
            }}
          >
            {label}
          </Text>
          <Text
            style={{
              color: primary ? '#E7EFEC' : color.text.secondary,
              fontSize: typography.supporting,
            }}
          >
            {description}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

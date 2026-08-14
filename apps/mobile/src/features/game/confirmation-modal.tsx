import { Modal, Pressable, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { spacing, touchTarget, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

interface ConfirmationModalProps {
  readonly visible: boolean;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly busy?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function ConfirmationModal({
  visible,
  title,
  description,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmationModalProps) {
  const { color } = useAppTheme();
  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={visible}
    >
      <View
        accessibilityViewIsModal
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: spacing.lg,
          backgroundColor: 'rgba(0, 0, 0, 0.62)',
        }}
      >
        <View
          style={{
            gap: spacing.lg,
            padding: spacing.lg,
            borderRadius: 20,
            borderCurve: 'continuous',
            backgroundColor: color.surface.card,
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.28)',
          }}
        >
          <View style={{ gap: spacing.sm }}>
            <Text
              accessibilityRole="header"
              selectable
              style={{
                color: color.text.primary,
                fontSize: typography.title,
                fontWeight: '900',
              }}
            >
              {title}
            </Text>
            <Text
              selectable
              style={{ color: color.text.secondary, fontSize: typography.body }}
            >
              {description}
            </Text>
          </View>
          <PrimaryButton
            label={confirmLabel}
            busy={busy}
            disabled={busy}
            onPress={onConfirm}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={onCancel}
            style={({ pressed }) => ({
              minHeight: touchTarget.minimum,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.68 : 1,
            })}
          >
            <Text
              selectable
              style={{
                color: color.text.primary,
                fontSize: typography.body,
                fontWeight: '700',
              }}
            >
              返回检查
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

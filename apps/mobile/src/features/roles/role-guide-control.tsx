import { useEffect, useState } from 'react';
import {
  AppState,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { useI18n } from '@/localization/localization-provider';
import { spacing, touchTarget, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

import { roleGuideFor } from './role-guide-content';
import type { RoleId } from './role-reveal-state';

export function RoleGuideControl({
  roleId,
  available = true,
  resetKey,
}: {
  readonly roleId: RoleId | null | undefined;
  readonly available?: boolean;
  readonly resetKey: string;
}) {
  const { color } = useAppTheme();
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const guide = roleGuideFor(roleId);

  useEffect(() => {
    setVisible(false);
  }, [available, resetKey, roleId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setVisible(false);
    });
    return () => {
      subscription.remove();
    };
  }, []);

  if (!available || guide === undefined) return null;

  return (
    <>
      <Pressable
        accessibilityHint={t('guideButtonHint')}
        accessibilityLabel={t('guideButtonAccessibility')}
        accessibilityRole="button"
        onPress={() => {
          setVisible(true);
        }}
        style={({ pressed }) => ({
          minHeight: touchTarget.minimum,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderRadius: 14,
          borderCurve: 'continuous',
          borderWidth: 2,
          borderColor: color.action.selected,
          backgroundColor: color.surface.private,
          opacity: pressed ? 0.72 : 1,
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
          {t('guideButton')}
        </Text>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => {
          setVisible(false);
        }}
        transparent
        visible={visible}
      >
        <ScrollView
          accessibilityViewIsModal
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            padding: spacing.lg,
          }}
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.76)' }}
        >
          <View
            style={{
              gap: spacing.lg,
              padding: spacing.lg,
              borderRadius: 22,
              borderCurve: 'continuous',
              backgroundColor: color.surface.private,
              boxShadow: '0 12px 40px rgba(0, 0, 0, 0.32)',
            }}
          >
            <View style={{ gap: spacing.sm }}>
              <Text
                selectable
                accessibilityRole="header"
                style={{
                  color: color.text.inverse,
                  fontSize: typography.title,
                  fontWeight: '900',
                }}
              >
                {t(guide.title)}
              </Text>
              <Text
                selectable
                style={{ color: '#D5D9E2', fontSize: typography.body }}
              >
                {t(guide.summary)}
              </Text>
              <Text
                selectable
                style={{ color: '#D5D9E2', fontSize: typography.supporting }}
              >
                {t('guidePrivacy')}
              </Text>
            </View>

            <View style={{ gap: spacing.md }}>
              {guide.tips.map((tip, index) => (
                <View
                  key={`${guide.title}-${String(index)}`}
                  style={{ flexDirection: 'row', gap: spacing.sm }}
                >
                  <Text
                    selectable
                    style={{
                      color: '#8ED5C5',
                      fontSize: typography.body,
                      fontWeight: '900',
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {index + 1}.
                  </Text>
                  <Text
                    selectable
                    style={{
                      flex: 1,
                      color: color.text.inverse,
                      fontSize: typography.body,
                    }}
                  >
                    {t(tip)}
                  </Text>
                </View>
              ))}
            </View>

            <PrimaryButton
              label={t('guideClose')}
              onPress={() => {
                setVisible(false);
              }}
            />
          </View>
        </ScrollView>
      </Modal>
    </>
  );
}

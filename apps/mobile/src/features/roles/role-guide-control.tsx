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
        accessibilityHint="打开仅与本人当前角色对应的私密玩法建议"
        accessibilityLabel="查看角色攻略"
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
          角色攻略
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
                {guide.title}
              </Text>
              <Text
                selectable
                style={{ color: '#D5D9E2', fontSize: typography.body }}
              >
                {guide.summary}
              </Text>
              <Text
                selectable
                style={{ color: '#D5D9E2', fontSize: typography.supporting }}
              >
                私密内容，请确认旁人无法看到屏幕。
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
                    {tip}
                  </Text>
                </View>
              ))}
            </View>

            <PrimaryButton
              label="关闭角色攻略"
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

import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { spacing, touchTarget, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

import { useSession } from './session-provider';

export function HostPauseControl() {
  const { color } = useAppTheme();
  const session = useSession();
  const [visible, setVisible] = useState(false);
  const [reason, setReason] = useState('');
  const canPause =
    session.status === 'CONNECTED' &&
    session.roomView?.private.availableActions.some(
      (action) => action.commandType === 'PauseGame',
    ) === true;

  useEffect(() => {
    setVisible(false);
    setReason('');
  }, [session.resyncEpoch]);

  if (!canPause) return null;

  return (
    <>
      <Pressable
        accessibilityHint="由房主暂停当前对局，暂停原因会公开给所有玩家"
        accessibilityLabel="暂停对局"
        accessibilityRole="button"
        onPress={() => {
          setVisible(true);
        }}
        style={({ pressed }) => ({
          position: 'absolute',
          right: spacing.md,
          bottom: spacing.lg,
          zIndex: 8,
          minHeight: touchTarget.minimum,
          justifyContent: 'center',
          paddingHorizontal: spacing.md,
          borderRadius: 999,
          backgroundColor: color.action.destructive,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <Text
          selectable
          style={{ color: color.text.inverse, fontWeight: '800' }}
        >
          暂停
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
        <View
          accessibilityViewIsModal
          style={{
            flex: 1,
            justifyContent: 'center',
            padding: spacing.lg,
            backgroundColor: 'rgba(0, 0, 0, 0.72)',
          }}
        >
          <View
            style={{
              gap: spacing.md,
              padding: spacing.lg,
              borderRadius: 22,
              backgroundColor: color.surface.card,
            }}
          >
            <Text
              accessibilityRole="header"
              selectable
              style={{
                color: color.text.primary,
                fontSize: typography.title,
                fontWeight: '900',
              }}
            >
              暂停对局
            </Text>
            <Text selectable style={{ color: color.text.secondary }}>
              原因可不填；填写后会公开给房间内所有玩家。
            </Text>
            <TextInput
              accessibilityLabel="公开暂停原因"
              maxLength={80}
              multiline
              onChangeText={setReason}
              placeholder="例如：短暂休息"
              placeholderTextColor={color.text.secondary}
              style={{
                minHeight: 96,
                padding: spacing.md,
                borderWidth: 1,
                borderColor: color.action.disabled,
                borderRadius: 14,
                color: color.text.primary,
                fontSize: typography.body,
                textAlignVertical: 'top',
              }}
              value={reason}
            />
            <PrimaryButton
              busy={session.pendingCommandType === 'PauseGame'}
              label="确认暂停"
              onPress={() => {
                const normalized = reason.normalize('NFC').trim();
                void session
                  .submitCommand({
                    type: 'PauseGame',
                    payload:
                      normalized.length === 0 ? {} : { reason: normalized },
                  })
                  .then(() => {
                    setVisible(false);
                  })
                  .catch(() => undefined);
              }}
            />
            <PrimaryButton
              label="取消"
              onPress={() => {
                setVisible(false);
                setReason('');
              }}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

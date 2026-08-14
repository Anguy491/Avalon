import { useEffect, useMemo, useState } from 'react';
import { Modal, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { spacing, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

import { useSession } from './session-provider';

function remainingLabel(expiresAt: string | null, now: number): string {
  if (expiresAt === null) return '等待服务器确认恢复期限';
  const remaining = Math.max(0, Date.parse(expiresAt) - now);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return `恢复窗口剩余 ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function SessionStatusLayer() {
  const { color } = useAppTheme();
  const session = useSession();
  const [now, setNow] = useState(Date.now());
  const paused = session.roomView?.public.phase === 'PAUSED';

  useEffect(() => {
    if (!paused) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [paused]);

  const offlinePlayers = useMemo(
    () =>
      session.roomView?.public.players.filter((player) => !player.connected) ??
      [],
    [session.roomView],
  );
  const canResume =
    session.status === 'CONNECTED' &&
    session.roomView?.private.availableActions.some(
      (action) => action.commandType === 'ResumeGame',
    ) === true;

  return (
    <>
      {!paused &&
      session.roomView !== undefined &&
      (session.status === 'OFFLINE' || session.status === 'RECOVERING') ? (
        <View
          accessibilityLiveRegion="polite"
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: spacing.lg,
            left: spacing.md,
            right: spacing.md,
            zIndex: 10,
            padding: spacing.md,
            borderRadius: 14,
            backgroundColor: color.surface.blocking,
          }}
        >
          <Text
            selectable
            style={{ color: color.text.inverse, fontWeight: '700' }}
          >
            {session.networkReachable
              ? '正在与服务器重新同步，操作已暂时停用。'
              : '网络已断开，当前仅显示最后一次公开状态。'}
          </Text>
        </View>
      ) : null}

      <Modal
        animationType="fade"
        onRequestClose={() => undefined}
        transparent
        visible={paused}
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
              backgroundColor: color.surface.blocking,
            }}
          >
            <Text
              accessibilityRole="header"
              selectable
              style={{
                color: color.text.inverse,
                fontSize: typography.title,
                fontWeight: '900',
              }}
            >
              游戏已暂停
            </Text>
            {session.roomView?.public.manualPauseReason !== null ? (
              <Text selectable style={{ color: color.text.inverse }}>
                手动原因：{session.roomView?.public.manualPauseReason}
              </Text>
            ) : null}
            {offlinePlayers.length > 0 ? (
              <Text selectable style={{ color: color.text.inverse }}>
                离线玩家：
                {offlinePlayers.map((player) => player.nickname).join('、')}
              </Text>
            ) : null}
            <Text selectable style={{ color: color.text.inverse }}>
              {remainingLabel(
                session.roomView?.public.recoveryExpiresAt ?? null,
                now,
              )}
            </Text>
            <Text selectable style={{ color: color.text.inverse }}>
              房主权限不会因断线而转移。倒计时仅供显示，最终以服务器裁决为准。
            </Text>
            {canResume ? (
              <PrimaryButton
                accessibilityHint="清除手动暂停；若仍有玩家离线，连接暂停会继续保留"
                busy={session.pendingCommandType === 'ResumeGame'}
                label="清除手动暂停"
                onPress={() => {
                  void session
                    .submitCommand({
                      type: 'ResumeGame',
                      payload: {},
                    })
                    .catch(() => undefined);
                }}
              />
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

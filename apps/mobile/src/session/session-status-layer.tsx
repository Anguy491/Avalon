import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, ScrollView, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { spacing, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

import { useSession } from './session-provider';
import {
  countdownLabel,
  derivePauseTerminationUiState,
  shouldRefreshPauseEligibility,
} from './pause-termination-state';

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
  const eligibilityRefreshInFlight = useRef(false);
  const paused = session.roomView?.public.phase === 'PAUSED';
  const pauseTermination = useMemo(
    () =>
      session.roomView === undefined
        ? undefined
        : derivePauseTerminationUiState(session.roomView, now),
    [now, session.roomView],
  );

  useEffect(() => {
    if (!paused) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [paused]);

  useEffect(() => {
    if (
      session.roomView?.public.phase !== 'GAME_OVER' ||
      session.roomView.public.gameOutcome?.reason !== 'ABORTED'
    ) {
      return;
    }
    router.replace('/');
  }, [session.roomView]);

  useEffect(() => {
    if (
      session.roomView === undefined ||
      pauseTermination === undefined ||
      !shouldRefreshPauseEligibility(
        session.roomView,
        pauseTermination,
        session.status === 'CONNECTED',
      ) ||
      eligibilityRefreshInFlight.current
    ) {
      return;
    }
    eligibilityRefreshInFlight.current = true;
    void session.refreshView().finally(() => {
      eligibilityRefreshInFlight.current = false;
    });
  }, [pauseTermination, paused, session]);

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
  const ballot = session.roomView?.public.pauseTerminationVote;

  const startTerminationVote = () => {
    Alert.alert(
      '发起终止对局投票？',
      '仅当前在线玩家进入本轮名单。投票持续 30 秒，只有严格超过半数选择继续暂停，对局才会保留。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '发起投票',
          style: 'destructive',
          onPress: () => {
            void session
              .submitCommand({
                type: 'StartPauseTerminationVote',
                payload: {},
              })
              .catch(() => undefined);
          },
        },
      ],
    );
  };

  const submitTerminationChoice = (choice: 'TERMINATE' | 'CONTINUE_PAUSE') => {
    const terminating = choice === 'TERMINATE';
    Alert.alert(
      terminating ? '确认终止对局？' : '确认继续暂停？',
      '投票提交后不能修改。个人选择不会在投票过程中公开。',
      [
        { text: '返回', style: 'cancel' },
        {
          text: terminating ? '投票终止' : '投票继续暂停',
          style: terminating ? 'destructive' : 'default',
          onPress: () => {
            void session
              .submitCommand({
                type: 'SubmitPauseTerminationVote',
                payload: { choice },
              })
              .catch(() => undefined);
          },
        },
      ],
    );
  };

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
        <ScrollView
          accessibilityViewIsModal
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            padding: spacing.lg,
          }}
          style={{
            flex: 1,
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
            {ballot == null &&
            pauseTermination !== undefined &&
            pauseTermination.availableInMs > 0 ? (
              <Text
                accessibilityLiveRegion="polite"
                selectable
                style={{
                  color: color.text.inverse,
                  fontVariant: ['tabular-nums'],
                }}
              >
                终止投票将在 {countdownLabel(pauseTermination.availableInMs)}{' '}
                后开放
              </Text>
            ) : null}
            {ballot == null && pauseTermination?.canStart === true ? (
              <PrimaryButton
                accessibilityHint="发起后仅当前在线玩家可在三十秒内投票"
                busy={
                  session.pendingCommandType === 'StartPauseTerminationVote'
                }
                label="发起终止对局投票"
                onPress={startTerminationVote}
              />
            ) : null}
            {ballot != null && pauseTermination !== undefined ? (
              <View
                accessible
                accessibilityLabel={`终止投票进度 ${String(pauseTermination.submittedCount)} / ${String(pauseTermination.eligibleCount)}，剩余 ${countdownLabel(pauseTermination.ballotRemainingMs)}`}
                style={{ gap: spacing.sm }}
              >
                <Text
                  accessibilityRole="header"
                  selectable
                  style={{
                    color: color.text.inverse,
                    fontSize: typography.body,
                    fontWeight: '800',
                  }}
                >
                  终止对局投票
                </Text>
                <Text
                  accessibilityLiveRegion="polite"
                  selectable
                  style={{
                    color: color.text.inverse,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  已提交 {pauseTermination.submittedCount} /{' '}
                  {pauseTermination.eligibleCount} · 剩余{' '}
                  {countdownLabel(pauseTermination.ballotRemainingMs)}
                </Text>
                <Text selectable style={{ color: color.text.inverse }}>
                  只有严格超过半数选择继续暂停，才会保留对局；否则对局中止并返回首页。
                </Text>
              </View>
            ) : null}
            {ballot != null && pauseTermination?.canSubmit === true ? (
              <>
                <PrimaryButton
                  busy={
                    session.pendingCommandType === 'SubmitPauseTerminationVote'
                  }
                  label="投票终止对局"
                  onPress={() => {
                    submitTerminationChoice('TERMINATE');
                  }}
                />
                <PrimaryButton
                  busy={
                    session.pendingCommandType === 'SubmitPauseTerminationVote'
                  }
                  label="投票继续暂停"
                  onPress={() => {
                    submitTerminationChoice('CONTINUE_PAUSE');
                  }}
                />
              </>
            ) : null}
            {ballot != null && pauseTermination?.voterStatus === 'SUBMITTED' ? (
              <Text
                accessibilityLiveRegion="polite"
                selectable
                style={{ color: color.text.inverse, fontWeight: '800' }}
              >
                你的投票已提交，等待本轮结算。
              </Text>
            ) : null}
            {ballot != null &&
            pauseTermination?.voterStatus === 'NOT_ELIGIBLE' ? (
              <Text selectable style={{ color: color.text.inverse }}>
                你不在本轮发起时的在线玩家名单中，只能查看投票进度。
              </Text>
            ) : null}
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
        </ScrollView>
      </Modal>
    </>
  );
}

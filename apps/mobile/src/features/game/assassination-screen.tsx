import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';

import { PageShell } from '@/components/page-shell';
import { PrimaryButton } from '@/components/primary-button';
import { useSession } from '@/session/session-provider';
import { spacing, touchTarget, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

import { deriveAssassinationState } from './assassination-state';
import { ConfirmationModal } from './confirmation-modal';
import { useGameCommands } from './use-game-commands';

export function AssassinationScreen() {
  const { color } = useAppTheme();
  const session = useSession();
  const commands = useGameCommands();
  const roomView = session.roomView;
  const state = useMemo(
    () =>
      roomView?.public.phase === 'ASSASSINATION'
        ? deriveAssassinationState(roomView)
        : undefined,
    [roomView],
  );
  const [targetPlayerId, setTargetPlayerId] = useState<string>();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const phase = roomView?.public.phase;
    if (phase === undefined || phase === 'ASSASSINATION') return;
    if (phase === 'LOBBY') router.replace('/lobby');
    else if (phase === 'ROLE_REVEAL') router.replace('/role');
    else if (phase === 'GAME_OVER') router.replace('/result');
    else router.replace('/game');
  }, [roomView?.public.phase]);

  useEffect(() => {
    setTargetPlayerId(undefined);
    setConfirming(false);
  }, [
    roomView?.public.phaseStage,
    roomView?.public.stateVersion,
    session.resyncEpoch,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        setTargetPlayerId(undefined);
        setConfirming(false);
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);

  if (roomView === undefined || state === undefined) {
    return (
      <PageShell>
        <Stack.Screen options={{ title: '刺杀' }} />
        <Text
          accessibilityRole="header"
          selectable
          style={{ color: color.text.primary, fontSize: typography.title }}
        >
          正在同步刺杀阶段
        </Text>
      </PageShell>
    );
  }

  const selected = state.targets.find(
    (player) => player.playerId === targetPlayerId,
  );
  const busy = commands.pendingCommandType !== undefined;
  const interactive = session.status === 'CONNECTED' && !busy;

  const submitTarget = async () => {
    if (targetPlayerId === undefined) return;
    const submitted = await commands.selectMerlinTarget(targetPlayerId);
    if (submitted) setTargetPlayerId(undefined);
    setConfirming(false);
  };

  return (
    <PageShell>
      <Stack.Screen
        options={{
          title: '刺杀',
          headerBackVisible: false,
          gestureEnabled: false,
        }}
      />

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
          三项任务成功
        </Text>
        <Text
          selectable
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          现在进行线下讨论。最终裁决前，任何玩家的角色都不会公开。
        </Text>
      </View>

      {state.phaseStage === 'HOST_HELD' ? (
        <View
          style={{
            gap: spacing.md,
            padding: spacing.lg,
            borderRadius: 18,
            borderCurve: 'continuous',
            backgroundColor: color.surface.blocking,
          }}
        >
          <Text
            accessibilityRole="header"
            selectable
            style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '900' }}
          >
            等待刺杀讨论完成
          </Text>
          <Text
            selectable
            style={{ color: '#D5D9E2', fontSize: typography.body }}
          >
            讨论完成后由房主开放刺杀选择。开放操作不会提前揭示角色。
          </Text>
          {state.canContinue ? (
            <PrimaryButton
              label="开放刺杀选择"
              busy={commands.pendingCommandType === 'ContinuePhase'}
              disabled={!interactive}
              onPress={() => void commands.continuePhase()}
            />
          ) : null}
        </View>
      ) : state.canSelectTarget ? (
        <View
          style={{
            gap: spacing.md,
            padding: spacing.lg,
            borderRadius: 18,
            borderCurve: 'continuous',
            backgroundColor: color.surface.private,
          }}
        >
          <Text
            accessibilityRole="header"
            selectable
            style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '900' }}
          >
            私密选择刺杀目标
          </Text>
          <Text
            selectable
            style={{ color: '#D5D9E2', fontSize: typography.body }}
          >
            候选由服务器授权，包含除你之外的所有玩家，不按阵营分组或过滤。
          </Text>
          {state.targets.map((player) => {
            const isSelected = player.playerId === targetPlayerId;
            return (
              <Pressable
                accessibilityLabel={`${String(player.seat + 1)}号位，${player.nickname}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
                disabled={!interactive}
                key={player.playerId}
                onPress={() => {
                  setTargetPlayerId(player.playerId);
                }}
                style={({ pressed }) => ({
                  minHeight: touchTarget.minimum,
                  justifyContent: 'center',
                  padding: spacing.md,
                  borderRadius: 14,
                  borderCurve: 'continuous',
                  borderWidth: 2,
                  borderColor: isSelected
                    ? color.action.selected
                    : color.action.disabled,
                  backgroundColor: isSelected ? '#303642' : '#20242E',
                  opacity: pressed ? 0.72 : 1,
                })}
              >
                <Text
                  selectable
                  style={{
                    color: '#FFFFFF',
                    fontSize: typography.body,
                    fontWeight: '800',
                  }}
                >
                  {player.seat + 1}号位 · {player.nickname}
                </Text>
              </Pressable>
            );
          })}
          <PrimaryButton
            label="确认刺杀目标"
            disabled={!interactive || selected === undefined}
            onPress={() => {
              setConfirming(true);
            }}
          />
        </View>
      ) : (
        <View
          style={{
            gap: spacing.md,
            padding: spacing.lg,
            borderRadius: 18,
            borderCurve: 'continuous',
            backgroundColor: color.surface.card,
          }}
        >
          <Text
            accessibilityRole="header"
            selectable
            style={{
              color: color.text.primary,
              fontSize: 20,
              fontWeight: '900',
            }}
          >
            等待刺客提交
          </Text>
          <Text
            selectable
            style={{ color: color.text.secondary, fontSize: typography.body }}
          >
            只有刺客会收到选择控件。请继续线下讨论并等待最终裁决。
          </Text>
        </View>
      )}

      <ConfirmationModal
        visible={confirming && selected !== undefined}
        title="确认最终刺杀目标？"
        description={`刺杀 ${selected?.nickname ?? ''}，提交后立即结束游戏。`}
        confirmLabel="确认刺杀"
        busy={commands.pendingCommandType === 'SelectMerlinTarget'}
        onCancel={() => {
          if (!busy) setConfirming(false);
        }}
        onConfirm={() => void submitTarget()}
      />
    </PageShell>
  );
}

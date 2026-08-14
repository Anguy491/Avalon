import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect, useMemo } from 'react';
import { Text, View, type ColorValue } from 'react-native';

import { PageShell } from '@/components/page-shell';
import { PrimaryButton } from '@/components/primary-button';
import { useSession } from '@/session/session-provider';
import { spacing, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

import { deriveResultState } from './result-state';

function ResultCard({
  children,
  backgroundColor,
}: {
  readonly children: React.ReactNode;
  readonly backgroundColor: ColorValue;
}) {
  return (
    <View
      style={{
        gap: spacing.md,
        padding: spacing.lg,
        borderRadius: 18,
        borderCurve: 'continuous',
        backgroundColor,
      }}
    >
      {children}
    </View>
  );
}

export function ResultScreen() {
  const { color } = useAppTheme();
  const session = useSession();
  const roomView = session.roomView;
  const result = useMemo(
    () => (roomView === undefined ? undefined : deriveResultState(roomView)),
    [roomView],
  );

  useEffect(() => {
    const phase = roomView?.public.phase;
    if (phase === undefined || phase === 'GAME_OVER') return;
    if (phase === 'LOBBY') router.replace('/lobby');
    else if (phase === 'ROLE_REVEAL') router.replace('/role');
    else if (phase === 'ASSASSINATION') router.replace('/assassination');
    else router.replace('/game');
  }, [roomView?.public.phase]);

  if (roomView === undefined || result === undefined) {
    return (
      <PageShell>
        <Stack.Screen options={{ title: '最终结果' }} />
        <Text
          accessibilityRole="header"
          selectable
          style={{ color: color.text.primary, fontSize: typography.title }}
        >
          正在载入最终结果
        </Text>
      </PageShell>
    );
  }

  const outcomeColor: ColorValue =
    result.winner === 'GOOD'
      ? color.result.success
      : result.winner === 'EVIL'
        ? color.result.failure
        : color.surface.blocking;
  const playerName = (playerId: string) =>
    result.players.find((player) => player.playerId === playerId)?.nickname ??
    '未知玩家';

  return (
    <PageShell>
      <Stack.Screen
        options={{
          title: '最终结果',
          headerBackVisible: false,
          gestureEnabled: false,
        }}
      />

      <ResultCard backgroundColor={outcomeColor}>
        <Text
          accessibilityLiveRegion="assertive"
          accessibilityRole="header"
          selectable
          style={{ color: '#FFFFFF', fontSize: 34, fontWeight: '900' }}
        >
          {result.winnerLabel}
        </Text>
        <Text
          selectable
          style={{ color: '#FFFFFF', fontSize: typography.body }}
        >
          {result.reasonLabel}
        </Text>
        {result.assassinationTarget === undefined ? null : (
          <Text
            selectable
            style={{ color: '#FFFFFF', fontSize: typography.body }}
          >
            刺杀目标：{result.assassinationTarget.seat + 1}号位 ·{' '}
            {result.assassinationTarget.nickname}
          </Text>
        )}
      </ResultCard>

      <ResultCard backgroundColor={color.surface.card}>
        <Text
          accessibilityRole="header"
          selectable
          style={{
            color: color.text.primary,
            fontSize: 20,
            fontWeight: '900',
          }}
        >
          最终比分
        </Text>
        <Text
          selectable
          style={{
            color: color.text.primary,
            fontSize: 24,
            fontWeight: '900',
            fontVariant: ['tabular-nums'],
          }}
        >
          成功 {result.successCount} · 失败 {result.failureCount}
        </Text>
      </ResultCard>

      <ResultCard backgroundColor={color.surface.card}>
        <Text
          accessibilityRole="header"
          selectable
          style={{
            color: color.text.primary,
            fontSize: 20,
            fontWeight: '900',
          }}
        >
          全部角色
        </Text>
        {result.revealedPlayers.map((player) => (
          <View
            accessible
            accessibilityLabel={`${String(player.seat + 1)}号位，${player.nickname}，${player.roleLabel}，${player.alignmentLabel}${player.wasAssassinationTarget ? '，刺杀目标' : ''}`}
            key={player.playerId}
            style={{
              gap: spacing.xs,
              padding: spacing.md,
              borderRadius: 14,
              borderCurve: 'continuous',
              backgroundColor: color.surface.public,
            }}
          >
            <Text
              selectable
              style={{
                color: color.text.primary,
                fontSize: typography.body,
                fontWeight: '900',
              }}
            >
              {player.seat + 1}号位 · {player.nickname}
              {player.wasAssassinationTarget ? ' · 刺杀目标' : ''}
            </Text>
            <Text
              selectable
              style={{
                color:
                  player.alignment === 'GOOD'
                    ? color.result.success
                    : color.result.failure,
                fontSize: typography.body,
                fontWeight: '800',
              }}
            >
              {player.roleLabel} · {player.alignmentLabel}
            </Text>
          </View>
        ))}
      </ResultCard>

      <ResultCard backgroundColor={color.surface.card}>
        <Text
          accessibilityRole="header"
          selectable
          style={{
            color: color.text.primary,
            fontSize: 20,
            fontWeight: '900',
          }}
        >
          公开对局历史
        </Text>
        {result.proposalHistory.map((proposal) => (
          <View
            key={`proposal-${String(proposal.questIndex)}-${String(proposal.proposalAttempt)}`}
            style={{ gap: spacing.xs }}
          >
            <Text
              selectable
              style={{
                color: color.text.primary,
                fontSize: typography.body,
                fontWeight: '900',
              }}
            >
              任务 {proposal.questIndex} · 第 {proposal.proposalAttempt} 次组队
              · {proposal.approved ? '通过' : '否决'}
            </Text>
            <Text
              selectable
              style={{
                color: color.text.secondary,
                fontSize: typography.supporting,
              }}
            >
              队长 {playerName(proposal.leaderPlayerId)}；同意{' '}
              {proposal.approveCount}，否决 {proposal.rejectCount}
            </Text>
            <Text
              selectable
              style={{
                color: color.text.secondary,
                fontSize: typography.supporting,
              }}
            >
              队伍：{proposal.teamPlayerIds.map(playerName).join('、')}
            </Text>
            {proposal.votes.map((vote) => (
              <Text
                key={`${String(proposal.questIndex)}-${String(proposal.proposalAttempt)}-${vote.playerId}`}
                selectable
                style={{
                  color: color.text.secondary,
                  fontSize: typography.supporting,
                }}
              >
                {playerName(vote.playerId)}：
                {vote.vote === 'APPROVE' ? '同意' : '否决'}
              </Text>
            ))}
          </View>
        ))}
        {result.questHistory.map((quest) => (
          <View
            key={`quest-${String(quest.questIndex)}`}
            style={{ gap: spacing.xs }}
          >
            <Text
              selectable
              style={{
                color: color.text.primary,
                fontSize: typography.body,
                fontWeight: '900',
              }}
            >
              任务 {quest.questIndex} ·{' '}
              {quest.result === 'SUCCESS' ? '成功' : '失败'}
            </Text>
            <Text
              selectable
              style={{
                color: color.text.secondary,
                fontSize: typography.supporting,
              }}
            >
              队伍：{quest.teamPlayerIds.map(playerName).join('、')}
            </Text>
            <Text
              selectable
              style={{
                color: color.text.secondary,
                fontSize: typography.supporting,
              }}
            >
              匿名行动：成功 {quest.successChoices}，失败 {quest.failChoices}
              ；失败阈值 {quest.requiredFails}
            </Text>
          </View>
        ))}
      </ResultCard>

      <Text
        selectable
        style={{ color: color.text.secondary, fontSize: typography.supporting }}
      >
        结果只保留在当前应用进程内。返回首页后将清除终局投影和本机会话。
      </Text>
      <PrimaryButton
        label="返回首页并清理本机会话"
        onPress={() => {
          void session.forgetSession().then(() => {
            router.replace('/');
          });
        }}
      />
    </PageShell>
  );
}

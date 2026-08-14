import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, Text, View, type ColorValue } from 'react-native';

import { PageShell } from '@/components/page-shell';
import { PrimaryButton } from '@/components/primary-button';
import { useSession } from '@/session/session-provider';
import { spacing, touchTarget, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

import { ConfirmationModal } from './confirmation-modal';
import { deriveGameTableState } from './game-state';
import { useGameCommands } from './use-game-commands';

type Confirmation =
  | { readonly type: 'TEAM' }
  | { readonly type: 'VOTE'; readonly vote: 'APPROVE' | 'REJECT' }
  | { readonly type: 'QUEST'; readonly choice: 'SUCCESS' | 'FAIL' };

type LocallySubmittedAction = 'VOTE' | 'QUEST';

function Card({
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
        padding: spacing.md,
        borderRadius: 18,
        borderCurve: 'continuous',
        backgroundColor,
      }}
    >
      {children}
    </View>
  );
}

function Heading({ children }: { readonly children: React.ReactNode }) {
  const { color } = useAppTheme();
  return (
    <Text
      accessibilityRole="header"
      selectable
      style={{
        color: color.text.primary,
        fontSize: 20,
        fontWeight: '900',
      }}
    >
      {children}
    </Text>
  );
}

export function GameScreen() {
  const { color } = useAppTheme();
  const session = useSession();
  const commands = useGameCommands();
  const roomView = session.roomView;
  const table = useMemo(
    () => (roomView === undefined ? undefined : deriveGameTableState(roomView)),
    [roomView],
  );
  const [selectedTeam, setSelectedTeam] = useState<readonly string[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [questChoicesVisible, setQuestChoicesVisible] = useState(false);
  const [locallySubmittedAction, setLocallySubmittedAction] =
    useState<LocallySubmittedAction>();
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const phaseIdentity = `${table?.phase ?? 'NONE'}:${table?.phaseStage ?? 'NONE'}:${String(
    table?.questIndex ?? 0,
  )}:${String(table?.proposalAttempt ?? 0)}:${String(roomView?.public.stateVersion ?? 0)}`;

  useEffect(() => {
    setSelectedTeam([]);
    setConfirmation(undefined);
    setQuestChoicesVisible(false);
    setLocallySubmittedAction(undefined);
  }, [phaseIdentity]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        setSelectedTeam([]);
        setConfirmation(undefined);
        setQuestChoicesVisible(false);
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const phase = roomView?.public.phase;
    if (phase === 'LOBBY') router.replace('/lobby');
    else if (phase === 'ROLE_REVEAL') router.replace('/role');
    else if (phase === 'ASSASSINATION') router.replace('/assassination');
    else if (phase === 'GAME_OVER') router.replace('/result');
  }, [roomView?.public.phase]);

  if (roomView === undefined || table === undefined) {
    return (
      <PageShell>
        <Stack.Screen options={{ title: '对局' }} />
        <Text
          accessibilityRole="header"
          selectable
          style={{ color: color.text.primary, fontSize: typography.title }}
        >
          正在同步公共桌面
        </Text>
        <PrimaryButton
          label="重新同步"
          onPress={() => void session.refreshView()}
        />
      </PageShell>
    );
  }

  const busy = commands.pendingCommandType !== undefined;
  const interactive = session.status === 'CONNECTED' && !busy;
  const latestProposal = table.latestProposal;
  const latestQuest = table.latestQuest;
  const requiredTeamSize = table.requiredTeamSize ?? 0;
  const selectedPlayers = table.players.filter((player) =>
    selectedTeam.includes(player.playerId),
  );

  const submitConfirmation = async () => {
    const pending = confirmation;
    if (pending === undefined) return;
    if (pending.type === 'TEAM') {
      const submitted = await commands.submitTeam(selectedTeam);
      if (submitted) setSelectedTeam([]);
    } else if (pending.type === 'VOTE') {
      const submitted = await commands.submitTeamVote(pending.vote);
      if (submitted) setLocallySubmittedAction('VOTE');
    } else {
      const submitted = await commands.submitQuestChoice(pending.choice);
      if (submitted) {
        setQuestChoicesVisible(false);
        setLocallySubmittedAction('QUEST');
      }
    }
    setConfirmation(undefined);
  };

  const confirmationContent = (() => {
    if (confirmation?.type === 'TEAM') {
      return {
        title: '确认提交队伍？',
        description: selectedPlayers
          .map((player) => `${String(player.seat + 1)}号位 ${player.nickname}`)
          .join('、'),
        confirmLabel: '确认提交队伍',
      };
    }
    if (confirmation?.type === 'VOTE') {
      const label = confirmation.vote === 'APPROVE' ? '同意' : '否决';
      return {
        title: `确认提交${label}？`,
        description: `你选择了“${label}”。提交后不能修改，结算前不会公开你的选择。`,
        confirmLabel: `确认${label}`,
      };
    }
    const label = confirmation?.choice === 'FAIL' ? '任务失败' : '任务成功';
    return {
      title: `确认提交${label}？`,
      description: `你选择了“${label}”。提交后不能修改，系统只会公开匿名汇总。`,
      confirmLabel: `确认${label}`,
    };
  })();

  return (
    <PageShell>
      <Stack.Screen
        options={{
          title: `任务 ${String(table.questIndex ?? '—')} · ${table.phaseTitle}`,
          headerBackVisible: false,
          gestureEnabled: false,
        }}
      />

      <View style={{ gap: spacing.xs }}>
        <Text
          accessibilityRole="header"
          selectable
          style={{
            color: color.text.primary,
            fontSize: typography.title,
            fontWeight: '900',
          }}
        >
          {table.phaseTitle}
        </Text>
        <Text
          selectable
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          当前队长：{table.leader?.nickname ?? '等待服务端分配'} · 第{' '}
          {table.proposalAttempt} 次组队尝试
        </Text>
        <Text
          accessibilityLiveRegion="polite"
          selectable
          style={{
            color: color.text.secondary,
            fontSize: typography.supporting,
          }}
        >
          连接状态：{session.status === 'CONNECTED' ? '在线' : '正在恢复'}
        </Text>
      </View>

      <Card backgroundColor={color.surface.card}>
        <Heading>五项任务</Heading>
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
        >
          {table.questTrack.map((quest) => {
            const label =
              quest.state === 'SUCCESS'
                ? '成功'
                : quest.state === 'FAILURE'
                  ? '失败'
                  : quest.state === 'CURRENT'
                    ? '当前'
                    : '待进行';
            const background =
              quest.state === 'SUCCESS'
                ? color.result.success
                : quest.state === 'FAILURE'
                  ? color.result.failure
                  : quest.state === 'CURRENT'
                    ? color.result.pending
                    : color.action.disabled;
            return (
              <View
                accessible
                accessibilityLabel={`任务 ${String(quest.questIndex)}，${label}${quest.requiredFails === 2 ? '，需要两张失败票' : ''}`}
                key={quest.questIndex}
                style={{
                  minWidth: 86,
                  flexGrow: 1,
                  gap: spacing.xs,
                  padding: spacing.sm,
                  borderRadius: 14,
                  borderCurve: 'continuous',
                  backgroundColor: background,
                }}
              >
                <Text
                  selectable
                  style={{ color: color.text.inverse, fontWeight: '900' }}
                >
                  任务 {quest.questIndex}
                </Text>
                <Text selectable style={{ color: color.text.inverse }}>
                  {label}
                </Text>
              </View>
            );
          })}
        </View>
        <Text
          selectable
          style={{
            color: color.text.primary,
            fontSize: typography.body,
            fontVariant: ['tabular-nums'],
            fontWeight: '800',
          }}
        >
          善方成功 {table.successCount} · 邪恶方成功 {table.failureCount}
        </Text>
        <Text
          selectable
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          本轮队伍需要 {table.requiredTeamSize ?? '—'} 人
          {table.requiredQuestFails === 2
            ? '；本轮需要至少两张失败票才会失败'
            : ''}
        </Text>
      </Card>

      {table.proposedTeam.length === 0 ? null : (
        <Card backgroundColor={color.surface.card}>
          <Heading>当前拟议队伍</Heading>
          <Text
            selectable
            style={{ color: color.text.primary, fontSize: typography.body }}
          >
            {table.proposedTeam
              .map(
                (player) => `${String(player.seat + 1)}号位 ${player.nickname}`,
              )
              .join('、')}
          </Text>
        </Card>
      )}

      {table.submissionProgress === undefined ? null : (
        <Card backgroundColor={color.surface.card}>
          <Heading>匿名提交进度</Heading>
          <Text
            accessibilityLiveRegion="polite"
            selectable
            style={{
              color: color.text.primary,
              fontSize: 24,
              fontWeight: '900',
              fontVariant: ['tabular-nums'],
            }}
          >
            {table.submissionProgress.submittedCount} /{' '}
            {table.submissionProgress.requiredCount}
          </Text>
          <Text
            selectable
            style={{
              color: color.text.secondary,
              fontSize: typography.supporting,
            }}
          >
            结算前只显示总数，不显示哪些玩家已经提交。
          </Text>
        </Card>
      )}

      {table.phaseStage === 'HOST_HELD' ? (
        <Card backgroundColor={color.surface.blocking}>
          <Text
            accessibilityRole="header"
            selectable
            style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '900' }}
          >
            先进行线下讨论
          </Text>
          <Text
            selectable
            style={{ color: '#D5D9E2', fontSize: typography.body }}
          >
            当前操作尚未开放。请等待房主继续。
          </Text>
          {table.canContinue && table.continueLabel !== undefined ? (
            <PrimaryButton
              label={table.continueLabel}
              busy={commands.pendingCommandType === 'ContinuePhase'}
              disabled={!interactive}
              onPress={() => void commands.continuePhase()}
            />
          ) : null}
        </Card>
      ) : null}

      {table.phase === 'TEAM_PROPOSAL' && table.phaseStage === 'COLLECTING' ? (
        table.canSubmitTeam ? (
          <Card backgroundColor={color.surface.card}>
            <Heading>选择 {requiredTeamSize} 名任务队员</Heading>
            {table.players.map((player) => {
              const selected = selectedTeam.includes(player.playerId);
              return (
                <Pressable
                  accessibilityLabel={`${String(player.seat + 1)}号位，${player.nickname}${player.playerId === table.selfPlayerId ? '，本人' : ''}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  key={player.playerId}
                  onPress={() => {
                    setSelectedTeam((current) =>
                      current.includes(player.playerId)
                        ? current.filter((id) => id !== player.playerId)
                        : current.length < requiredTeamSize
                          ? [...current, player.playerId]
                          : current,
                    );
                  }}
                  style={({ pressed }) => ({
                    minHeight: touchTarget.minimum,
                    justifyContent: 'center',
                    padding: spacing.md,
                    borderRadius: 14,
                    borderCurve: 'continuous',
                    borderWidth: 2,
                    borderColor: selected
                      ? color.action.selected
                      : color.action.disabled,
                    backgroundColor: selected
                      ? color.result.pending
                      : color.surface.public,
                    opacity: pressed ? 0.72 : 1,
                  })}
                >
                  <Text
                    selectable
                    style={{
                      color: color.text.primary,
                      fontSize: typography.body,
                      fontWeight: '800',
                    }}
                  >
                    {player.seat + 1}号位 · {player.nickname}
                    {player.playerId === table.selfPlayerId ? '（你）' : ''}
                  </Text>
                </Pressable>
              );
            })}
            <PrimaryButton
              label={`提交队伍（${String(selectedTeam.length)}/${String(requiredTeamSize)}）`}
              disabled={
                !interactive || selectedTeam.length !== requiredTeamSize
              }
              onPress={() => {
                setConfirmation({ type: 'TEAM' });
              }}
            />
          </Card>
        ) : (
          <Card backgroundColor={color.surface.card}>
            <Heading>等待队长组队</Heading>
            <Text
              selectable
              style={{ color: color.text.secondary, fontSize: typography.body }}
            >
              当前只有队长可以选择并提交队伍。
            </Text>
          </Card>
        )
      ) : null}

      {table.phase === 'TEAM_VOTE' && table.phaseStage === 'COLLECTING' ? (
        table.hasSubmitted || locallySubmittedAction === 'VOTE' ? (
          <Card backgroundColor={color.surface.private}>
            <Text
              accessibilityRole="header"
              selectable
              style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '900' }}
            >
              你的投票已提交
            </Text>
            <Text
              selectable
              style={{ color: '#D5D9E2', fontSize: typography.body }}
            >
              选择已隐藏。请等待所有玩家完成投票。
            </Text>
          </Card>
        ) : table.allowedTeamVotes.length > 0 ? (
          <Card backgroundColor={color.surface.private}>
            <Text
              accessibilityRole="header"
              selectable
              style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '900' }}
            >
              私密组队票
            </Text>
            <Text
              selectable
              style={{ color: '#D5D9E2', fontSize: typography.body }}
            >
              请选择后再次确认。提交前请遮挡屏幕。
            </Text>
            {table.allowedTeamVotes.includes('APPROVE') ? (
              <PrimaryButton
                label="✓ 同意这支队伍"
                disabled={!interactive}
                onPress={() => {
                  setConfirmation({ type: 'VOTE', vote: 'APPROVE' });
                }}
              />
            ) : null}
            {table.allowedTeamVotes.includes('REJECT') ? (
              <Pressable
                accessibilityRole="button"
                disabled={!interactive}
                onPress={() => {
                  setConfirmation({ type: 'VOTE', vote: 'REJECT' });
                }}
                style={({ pressed }) => ({
                  minHeight: touchTarget.minimum,
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: spacing.md,
                  borderRadius: 16,
                  borderCurve: 'continuous',
                  borderWidth: 2,
                  borderColor: color.action.destructive,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text
                  selectable
                  style={{
                    color: '#FFFFFF',
                    fontSize: typography.body,
                    fontWeight: '900',
                  }}
                >
                  ✕ 否决这支队伍
                </Text>
              </Pressable>
            ) : null}
          </Card>
        ) : null
      ) : null}

      {table.phase === 'TEAM_VOTE' &&
      table.phaseStage === 'RESOLVED' &&
      latestProposal !== undefined ? (
        <Card backgroundColor={color.surface.card}>
          <Heading>
            {latestProposal.approved ? '队伍已通过' : '队伍被否决'}
          </Heading>
          <Text
            selectable
            style={{
              color: color.text.primary,
              fontSize: typography.body,
              fontWeight: '900',
            }}
          >
            同意 {latestProposal.approveCount} · 否决{' '}
            {latestProposal.rejectCount}
          </Text>
          {latestProposal.votes.map((vote) => {
            const player = table.players.find(
              (candidate) => candidate.playerId === vote.playerId,
            );
            return (
              <Text
                key={vote.playerId}
                selectable
                style={{ color: color.text.primary, fontSize: typography.body }}
              >
                {player?.seat === undefined
                  ? '—'
                  : `${String(player.seat + 1)}号位`}{' '}
                {player?.nickname ?? '未知玩家'}：
                {vote.vote === 'APPROVE' ? '同意' : '否决'}
              </Text>
            );
          })}
          {!latestProposal.approved &&
          latestProposal.approveCount === latestProposal.rejectCount ? (
            <Text
              selectable
              style={{
                color: color.result.failure,
                fontSize: typography.body,
                fontWeight: '800',
              }}
            >
              平票按规则视为否决。
            </Text>
          ) : null}
          {!latestProposal.approved && table.outcomeLabel === undefined ? (
            <Text
              selectable
              style={{ color: color.text.secondary, fontSize: typography.body }}
            >
              下一位队长：{table.leader?.nickname ?? '等待服务端分配'}
            </Text>
          ) : null}
          {table.outcomeLabel === undefined ? null : (
            <Text
              accessibilityLiveRegion="assertive"
              selectable
              style={{
                color: color.result.failure,
                fontSize: typography.body,
                fontWeight: '900',
              }}
            >
              {table.outcomeLabel}
            </Text>
          )}
          {table.canContinue && table.continueLabel !== undefined ? (
            <PrimaryButton
              label={table.continueLabel}
              busy={commands.pendingCommandType === 'ContinuePhase'}
              disabled={!interactive}
              onPress={() => void commands.continuePhase()}
            />
          ) : null}
        </Card>
      ) : null}

      {table.phase === 'QUEST_SUBMISSION' &&
      table.phaseStage === 'COLLECTING' ? (
        table.hasSubmitted || locallySubmittedAction === 'QUEST' ? (
          <Card backgroundColor={color.surface.private}>
            <Text
              accessibilityRole="header"
              selectable
              style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '900' }}
            >
              任务行动已提交
            </Text>
            <Text
              selectable
              style={{ color: '#D5D9E2', fontSize: typography.body }}
            >
              具体选择已隐藏。请保持中性画面并等待结算。
            </Text>
          </Card>
        ) : table.allowedQuestChoices.length > 0 ? (
          <Card backgroundColor={color.surface.private}>
            <Text
              accessibilityRole="header"
              selectable
              style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '900' }}
            >
              私密任务行动
            </Text>
            {!questChoicesVisible ? (
              <>
                <Text
                  selectable
                  style={{ color: '#D5D9E2', fontSize: typography.body }}
                >
                  请先遮挡屏幕，确认旁人无法看到后再显示合法选项。
                </Text>
                <PrimaryButton
                  label="显示我的任务选项"
                  disabled={!interactive}
                  onPress={() => {
                    setQuestChoicesVisible(true);
                  }}
                />
              </>
            ) : (
              <>
                {table.requiredQuestFails === 2 ? (
                  <Text
                    selectable
                    style={{
                      color: '#FFFFFF',
                      fontSize: typography.body,
                      fontWeight: '900',
                    }}
                  >
                    本轮需要至少两张失败票才会失败。
                  </Text>
                ) : null}
                {table.allowedQuestChoices.includes('SUCCESS') ? (
                  <PrimaryButton
                    label="✓ 任务成功"
                    disabled={!interactive}
                    onPress={() => {
                      setConfirmation({ type: 'QUEST', choice: 'SUCCESS' });
                    }}
                  />
                ) : null}
                {table.allowedQuestChoices.includes('FAIL') ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={!interactive}
                    onPress={() => {
                      setConfirmation({ type: 'QUEST', choice: 'FAIL' });
                    }}
                    style={({ pressed }) => ({
                      minHeight: touchTarget.minimum,
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: spacing.md,
                      borderRadius: 16,
                      borderCurve: 'continuous',
                      borderWidth: 2,
                      borderColor: color.action.destructive,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text
                      selectable
                      style={{
                        color: '#FFFFFF',
                        fontSize: typography.body,
                        fontWeight: '900',
                      }}
                    >
                      ✕ 任务失败
                    </Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </Card>
        ) : (
          <Card backgroundColor={color.surface.card}>
            <Heading>等待任务队员</Heading>
            <Text
              selectable
              style={{ color: color.text.secondary, fontSize: typography.body }}
            >
              你不在本次获批队伍中。公开页面只显示匿名提交总数。
            </Text>
          </Card>
        )
      ) : null}

      {table.phase === 'QUEST_RESOLUTION' && latestQuest !== undefined ? (
        <Card backgroundColor={color.surface.card}>
          <Heading>
            {latestQuest.result === 'SUCCESS' ? '任务成功' : '任务失败'}
          </Heading>
          <Text
            selectable
            style={{
              color: color.text.primary,
              fontSize: 24,
              fontWeight: '900',
              fontVariant: ['tabular-nums'],
            }}
          >
            成功票 {latestQuest.successChoices} · 失败票{' '}
            {latestQuest.failChoices}
          </Text>
          <Text
            selectable
            style={{ color: color.text.secondary, fontSize: typography.body }}
          >
            本次任务需要 {latestQuest.requiredFails}{' '}
            张失败票才会失败。行动始终匿名，不公开玩家对应关系。
          </Text>
          {table.outcomeLabel === undefined ? null : (
            <Text
              accessibilityLiveRegion="assertive"
              selectable
              style={{
                color: color.result.failure,
                fontSize: typography.body,
                fontWeight: '900',
              }}
            >
              {table.outcomeLabel}
            </Text>
          )}
          {table.canContinue && table.continueLabel !== undefined ? (
            <PrimaryButton
              label={table.continueLabel}
              busy={commands.pendingCommandType === 'ContinuePhase'}
              disabled={!interactive}
              onPress={() => void commands.continuePhase()}
            />
          ) : null}
        </Card>
      ) : null}

      {table.phase === 'ASSASSINATION' ? (
        <Card backgroundColor={color.surface.card}>
          <Heading>三项任务成功</Heading>
          <Text
            selectable
            style={{ color: color.text.secondary, fontSize: typography.body }}
          >
            现在进入刺杀讨论。角色仍然保密；刺杀选择将在下一阶段由服务端授权给刺客。
          </Text>
          {table.canContinue && table.continueLabel !== undefined ? (
            <PrimaryButton
              label={table.continueLabel}
              busy={commands.pendingCommandType === 'ContinuePhase'}
              disabled={!interactive}
              onPress={() => void commands.continuePhase()}
            />
          ) : null}
        </Card>
      ) : null}

      {table.phase === 'GAME_OVER' ? (
        <Card backgroundColor={color.surface.card}>
          <Heading>裁决已锁定</Heading>
          <Text
            accessibilityLiveRegion="assertive"
            selectable
            style={{
              color: color.text.primary,
              fontSize: typography.body,
              fontWeight: '900',
            }}
          >
            {table.outcomeLabel ?? '对局已结束。'}
          </Text>
          <Text
            selectable
            style={{ color: color.text.secondary, fontSize: typography.body }}
          >
            完整角色揭示和结果页将在终局流程中显示；本页不会公开任务行动归属。
          </Text>
        </Card>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: historyExpanded }}
        onPress={() => {
          setHistoryExpanded((current) => !current);
        }}
        style={({ pressed }) => ({
          minHeight: touchTarget.minimum,
          justifyContent: 'center',
          padding: spacing.md,
          borderRadius: 16,
          borderCurve: 'continuous',
          backgroundColor: color.surface.card,
          opacity: pressed ? 0.72 : 1,
        })}
      >
        <Text
          selectable
          style={{
            color: color.text.primary,
            fontSize: typography.body,
            fontWeight: '900',
          }}
        >
          {historyExpanded ? '收起对局记录' : '展开对局记录'}
        </Text>
      </Pressable>
      {historyExpanded ? (
        <Card backgroundColor={color.surface.card}>
          <Heading>公开对局记录</Heading>
          {table.proposalHistory.length === 0 &&
          table.questHistory.length === 0 ? (
            <Text
              selectable
              style={{ color: color.text.secondary, fontSize: typography.body }}
            >
              暂无已公开记录。
            </Text>
          ) : null}
          {table.proposalHistory.map((proposal) => {
            const leader = table.players.find(
              (player) => player.playerId === proposal.leaderPlayerId,
            );
            return (
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
                  任务 {proposal.questIndex} · 第 {proposal.proposalAttempt}{' '}
                  次组队 · {proposal.approved ? '通过' : '否决'}
                </Text>
                <Text
                  selectable
                  style={{
                    color: color.text.secondary,
                    fontSize: typography.supporting,
                  }}
                >
                  队长 {leader?.nickname ?? '—'}；同意 {proposal.approveCount}
                  ，否决 {proposal.rejectCount}
                </Text>
                <Text
                  selectable
                  style={{
                    color: color.text.secondary,
                    fontSize: typography.supporting,
                  }}
                >
                  队伍：
                  {proposal.teamPlayerIds
                    .flatMap((playerId) => {
                      const player = table.players.find(
                        (candidate) => candidate.playerId === playerId,
                      );
                      return player === undefined
                        ? []
                        : [`${String(player.seat + 1)}号位 ${player.nickname}`];
                    })
                    .join('、')}
                </Text>
                {proposal.votes.map((vote) => {
                  const player = table.players.find(
                    (candidate) => candidate.playerId === vote.playerId,
                  );
                  return (
                    <Text
                      key={`${String(proposal.questIndex)}-${String(proposal.proposalAttempt)}-${vote.playerId}`}
                      selectable
                      style={{
                        color: color.text.secondary,
                        fontSize: typography.supporting,
                      }}
                    >
                      {player === undefined
                        ? '未知玩家'
                        : `${String(player.seat + 1)}号位 ${player.nickname}`}
                      ：{vote.vote === 'APPROVE' ? '同意' : '否决'}
                    </Text>
                  );
                })}
              </View>
            );
          })}
          {table.questHistory.map((quest) => (
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
                匿名成功票 {quest.successChoices}，失败票 {quest.failChoices}
                ，失败阈值 {quest.requiredFails}
              </Text>
              <Text
                selectable
                style={{
                  color: color.text.secondary,
                  fontSize: typography.supporting,
                }}
              >
                获批队伍：
                {quest.teamPlayerIds
                  .flatMap((playerId) => {
                    const player = table.players.find(
                      (candidate) => candidate.playerId === playerId,
                    );
                    return player === undefined
                      ? []
                      : [`${String(player.seat + 1)}号位 ${player.nickname}`];
                  })
                  .join('、')}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      {commands.notice === undefined ? null : (
        <Text
          accessibilityLiveRegion="polite"
          selectable
          style={{ color: color.result.success, fontSize: typography.body }}
        >
          {commands.notice}
        </Text>
      )}
      {session.error === undefined ? null : (
        <View style={{ gap: spacing.sm }}>
          <Text
            accessibilityLiveRegion="assertive"
            selectable
            style={{ color: color.result.failure, fontSize: typography.body }}
          >
            {session.error}
          </Text>
          <PrimaryButton
            label="重新同步"
            disabled={busy}
            onPress={() => void session.refreshView()}
          />
        </View>
      )}

      <ConfirmationModal
        busy={busy}
        confirmLabel={confirmationContent.confirmLabel}
        description={confirmationContent.description}
        onCancel={() => {
          setConfirmation(undefined);
        }}
        onConfirm={() => void submitConfirmation()}
        title={confirmationContent.title}
        visible={confirmation !== undefined}
      />
    </PageShell>
  );
}

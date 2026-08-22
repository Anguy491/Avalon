import { Button, Text, Textarea, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useReducer, useState } from 'react';

import { rolePresentation } from '@avalon/client-core';

import { PageShell } from '@/components/page-shell';
import { PlayerList } from '@/components/player-list';
import {
  EMPTY_PRIVATE_ACTION,
  privateActionReducer,
} from '@/game/private-action-state';
import { voicePackEntryFor } from '@/audio/voice-pack.generated';
import { useSession } from '@/session/session-provider';

const PHASE_LABELS: Readonly<Record<string, string>> = {
  TEAM_PROPOSAL: '队长组队',
  TEAM_VOTE: '全员投票',
  QUEST_SUBMISSION: '任务行动',
  QUEST_RESOLUTION: '任务结果',
  PAUSED: '对局暂停',
  ROLE_REVEAL: '身份确认',
  LOBBY: '房间大厅',
  ASSASSINATION: '刺杀讨论',
  GAME_OVER: '对局结束',
} as const;

async function confirmSecret(content: string): Promise<boolean> {
  return (
    await Taro.showModal({
      title: '确认不可撤销操作',
      content,
      confirmText: '确认提交',
      cancelText: '再想想',
    })
  ).confirm;
}

function remainingLabel(expiresAt: string | null, nowMs: number): string {
  if (expiresAt === null) return '未设置';
  const remaining = Math.max(0, Date.parse(expiresAt) - nowMs);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function GamePage() {
  const { roomView, submitCommand, pendingCommandType, privacyHidden } =
    useSession();
  const [selectedTeam, setSelectedTeam] = useState<Set<string>>(new Set());
  const [pauseReason, setPauseReason] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [privateState, dispatchPrivate] = useReducer(
    privateActionReducer,
    EMPTY_PRIVATE_ACTION,
  );
  const privateAction = privateState.action;
  const privateChoice = privateState.choice;
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    setSelectedTeam(new Set());
    setGuideOpen(false);
    dispatchPrivate({ type: 'RESET' });
  }, [privacyHidden, roomView?.public.phase, roomView?.public.stateVersion]);
  useEffect(() => {
    if (roomView?.public.phase !== 'PAUSED') return;
    setNowMs(Date.now());
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [roomView?.public.phase]);
  if (roomView === undefined) return <PageShell title="正在恢复对局" />;
  const players = [...roomView.public.players].sort((a, b) => a.seat - b.seat);
  const names = new Map(
    players.map((player) => [player.playerId, player.nickname]),
  );
  const actions = new Map(
    roomView.private.availableActions.map((action) => [
      action.commandType,
      action,
    ]),
  );
  const role = rolePresentation(roomView.private.selfRole);
  const busy = pendingCommandType !== undefined;
  const requiredTeamSize = roomView.public.requiredTeamSize ?? 0;
  const selectedPlayers = players.filter((player) =>
    selectedTeam.has(player.playerId),
  );
  const teamVotes = (
    actions.get('SubmitTeamVote')?.allowedTeamVotes ?? []
  ).filter(
    (vote): vote is 'APPROVE' | 'REJECT' =>
      vote === 'APPROVE' || vote === 'REJECT',
  );
  const questChoices = (
    actions.get('SubmitQuestChoice')?.allowedQuestChoices ?? []
  ).filter(
    (choice): choice is 'SUCCESS' | 'FAIL' =>
      choice === 'SUCCESS' || choice === 'FAIL',
  );
  const terminationChoices = (
    actions.get('SubmitPauseTerminationVote')?.allowedPauseTerminationChoices ??
    []
  ).filter(
    (choice): choice is 'CONTINUE_PAUSE' | 'TERMINATE' =>
      choice === 'CONTINUE_PAUSE' || choice === 'TERMINATE',
  );
  const cue = roomView.public.currentAudioCue;
  const cueEntry =
    cue === null || cue === undefined
      ? undefined
      : voicePackEntryFor(cue.audioCueKey);
  const offlinePlayers = players.filter((player) => !player.connected);
  const toggleTeam = (playerId: string) => {
    if (!actions.has('SubmitTeam')) return;
    setSelectedTeam((current) => {
      const next = new Set(current);
      if (next.has(playerId)) next.delete(playerId);
      else if (next.size < requiredTeamSize) next.add(playerId);
      return next;
    });
  };

  return (
    <PageShell
      title={PHASE_LABELS[roomView.public.phase] ?? '进行中的对局'}
      subtitle={`任务 ${roomView.public.questIndex === null ? '—' : String(roomView.public.questIndex)} · 第 ${String(roomView.public.proposalAttempt)} 次组队 · 状态 ${roomView.public.phaseStage}`}
    >
      {cue === null || cue === undefined ? null : (
        <View className="card">
          <Text className="section-title">主持字幕</Text>
          <View>
            {cueEntry?.subtitle ?? '语音资源不可用，请根据当前阶段继续。'}
          </View>
        </View>
      )}
      <View className="card">
        <View className="row">
          <Text>任务成功 {roomView.public.successCount}</Text>
          <View className="spacer" />
          <Text>任务失败 {roomView.public.failureCount}</Text>
        </View>
        <View className="row-wrap" style="margin-top:16px;">
          {Array.from({ length: 5 }, (_, index) => {
            const questIndex = index + 1;
            const settled = roomView.public.questHistory.find(
              (quest) => quest.questIndex === questIndex,
            );
            const label =
              settled?.result === 'SUCCESS'
                ? '成功'
                : settled?.result === 'FAILURE'
                  ? '失败'
                  : roomView.public.questIndex === questIndex
                    ? '当前'
                    : '待定';
            return (
              <View className="badge" key={questIndex}>
                任务 {questIndex}：{label}
              </View>
            );
          })}
        </View>
        {roomView.public.leaderPlayerId == null ? null : (
          <View className="progress">
            当前队长：{names.get(roomView.public.leaderPlayerId) ?? '同桌玩家'}
          </View>
        )}
        {roomView.public.proposedTeamPlayerIds.length === 0 ? null : (
          <View className="progress">
            当前队伍：
            {roomView.public.proposedTeamPlayerIds
              .map((id) => names.get(id) ?? '同桌玩家')
              .join('、')}
          </View>
        )}
        {roomView.public.submissionProgress == null ? null : (
          <View className="progress">
            提交进度：{roomView.public.submissionProgress.submittedCount}/
            {roomView.public.submissionProgress.requiredCount}
          </View>
        )}
      </View>

      <PlayerList
        players={players}
        selfPlayerId={roomView.private.playerId}
        selectedIds={selectedTeam}
        onSelect={toggleTeam}
      />

      {actions.has('SubmitTeam') ? (
        <View className="card">
          <Text className="section-title">选择任务队伍</Text>
          <View className="progress">
            已选 {selectedPlayers.length}/{requiredTeamSize}：
            {selectedPlayers.map((player) => player.nickname).join('、')}
          </View>
          <Button
            className="button"
            disabled={busy || selectedPlayers.length !== requiredTeamSize}
            onClick={() =>
              void Taro.showModal({
                title: '确认任务队伍',
                content: selectedPlayers
                  .map(
                    (player) =>
                      `${String(player.seat + 1)} 号 ${player.nickname}`,
                  )
                  .join('、'),
                confirmText: '提交队伍',
              }).then((result) => {
                if (result.confirm)
                  void submitCommand({
                    type: 'SubmitTeam',
                    payload: {
                      teamPlayerIds: selectedPlayers.map(
                        (player) => player.playerId,
                      ),
                    },
                  });
              })
            }
          >
            提交队伍
          </Button>
        </View>
      ) : null}

      {teamVotes.length === 0 ? null : (
        <Button
          className="button"
          disabled={busy}
          ariaLabel="进入私密组队投票"
          onClick={() => {
            dispatchPrivate({ type: 'OPEN', action: 'TEAM_VOTE' });
          }}
        >
          进入私密组队投票
        </Button>
      )}

      {questChoices.length === 0 ? null : (
        <Button
          className="button"
          disabled={busy}
          ariaLabel="进入私密任务行动"
          onClick={() => {
            dispatchPrivate({ type: 'OPEN', action: 'QUEST' });
          }}
        >
          进入私密任务行动
        </Button>
      )}
      {roomView.private.hasSubmitted ? (
        <View className="card">你的秘密行动已提交，等待其他玩家。</View>
      ) : null}

      {actions.has('ContinuePhase') ? (
        <Button
          className="button"
          disabled={busy}
          onClick={() =>
            void submitCommand({ type: 'ContinuePhase', payload: {} })
          }
        >
          房主继续当前阶段
        </Button>
      ) : null}

      {actions.has('PauseGame') ? (
        <View className="card">
          <Text className="section-title">房主暂停</Text>
          <Textarea
            className="textarea"
            maxlength={80}
            value={pauseReason}
            placeholder="可选的公开暂停原因"
            onInput={(event) => {
              setPauseReason(event.detail.value);
            }}
          />
          <Button
            className="button button-secondary"
            disabled={busy}
            onClick={() =>
              void submitCommand({
                type: 'PauseGame',
                payload:
                  pauseReason.trim().length === 0
                    ? {}
                    : { reason: pauseReason.trim() },
              })
            }
          >
            暂停对局
          </Button>
        </View>
      ) : null}
      {role === undefined ||
      roomView.public.phase === 'PAUSED' ||
      privacyHidden ? null : (
        <View className="card">
          <Button
            className="button button-secondary"
            onClick={() => {
              setGuideOpen((open) => !open);
            }}
          >
            {guideOpen ? '关闭本人角色攻略' : '查看本人角色攻略'}
          </Button>
        </View>
      )}
      {actions.has('ReplayAudioCue') && cue != null ? (
        <Button
          className="button button-secondary"
          disabled={busy}
          onClick={() =>
            void submitCommand({
              type: 'ReplayAudioCue',
              payload: { audioCueId: cue.audioCueId },
            })
          }
        >
          重播当前主持语音
        </Button>
      ) : null}

      <View className="card">
        <Text className="section-title">公开对局记录</Text>
        {roomView.public.proposalHistory.length === 0 &&
        roomView.public.questHistory.length === 0 ? (
          <View className="muted">暂无已结算记录。</View>
        ) : null}
        {roomView.public.proposalHistory.map((record, index) => (
          <View className="history-record" key={['proposal', index].join('-')}>
            <View className="subtitle">
              任务 {record.questIndex} 第 {record.proposalAttempt} 次组队：
              {record.approved ? '通过' : '否决'}（{record.approveCount} 同意 /{' '}
              {record.rejectCount} 否决）
            </View>
            <View className="progress">
              队长：{names.get(record.leaderPlayerId) ?? '同桌玩家'}；队伍：
              {record.teamPlayerIds
                .map((playerId) => names.get(playerId) ?? '同桌玩家')
                .join('、')}
            </View>
            <View className="progress">
              {record.votes
                .map(
                  (entry) =>
                    `${names.get(entry.playerId) ?? '同桌玩家'}：${entry.vote === 'APPROVE' ? '同意' : '否决'}`,
                )
                .join('；')}
            </View>
          </View>
        ))}
        {roomView.public.questHistory.map((record) => (
          <View
            className="subtitle"
            key={['quest', record.questIndex].join('-')}
          >
            任务 {record.questIndex}：
            {record.result === 'SUCCESS' ? '成功' : '失败'}（成功{' '}
            {record.successChoices} / 失败 {record.failChoices}）
          </View>
        ))}
      </View>

      {guideOpen && role !== undefined ? (
        <View className="private-action-overlay">
          <Text className="title">{role.label} · 私密攻略</Text>
          <View className="subtitle">
            只依据你的本人身份生成，请勿展示给他人。
          </View>
          {role.guide.map((tip) => (
            <View className="card" key={tip}>
              {tip}
            </View>
          ))}
          <Button
            className="button"
            onClick={() => {
              setGuideOpen(false);
            }}
          >
            关闭并遮挡
          </Button>
        </View>
      ) : null}

      {roomView.public.phase === 'PAUSED' ? (
        <View className="pause-overlay">
          <Text className="title">对局已暂停</Text>
          <View className="subtitle">
            原因：{roomView.public.pauseReasons.join('、') || '等待恢复'}
          </View>
          {roomView.public.manualPauseReason == null ? null : (
            <View className="card">
              房主说明：{roomView.public.manualPauseReason}
            </View>
          )}
          <View className="card">
            <Text className="section-title">离线玩家</Text>
            <View>
              {offlinePlayers.length === 0
                ? '暂无离线玩家'
                : offlinePlayers.map((player) => player.nickname).join('、')}
            </View>
            <View className="progress">
              恢复倒计时：
              {remainingLabel(roomView.public.recoveryExpiresAt, nowMs)}
            </View>
          </View>
          <View className="card">
            <Text className="section-title">终止投票</Text>
            <View>
              资格：
              {roomView.private.pauseTerminationVoteStatus === 'NOT_ELIGIBLE'
                ? '无资格'
                : roomView.private.pauseTerminationVoteStatus === 'SUBMITTED'
                  ? '已提交'
                  : roomView.private.pauseTerminationVoteStatus === 'PENDING'
                    ? '待提交'
                    : '尚未开始'}
            </View>
            {roomView.public.pauseTerminationVote == null ? null : (
              <>
                <View className="progress">
                  进度：{roomView.public.pauseTerminationVote.submittedCount}/
                  {roomView.public.pauseTerminationVote.eligibleCount}
                </View>
                <View className="progress">
                  截止倒计时：
                  {remainingLabel(
                    roomView.public.pauseTerminationVote.expiresAt,
                    nowMs,
                  )}
                </View>
              </>
            )}
          </View>
          {actions.has('ResumeGame') ? (
            <Button
              className="button"
              disabled={busy}
              onClick={() =>
                void submitCommand({ type: 'ResumeGame', payload: {} })
              }
            >
              房主恢复对局
            </Button>
          ) : null}
          {actions.has('StartPauseTerminationVote') ? (
            <Button
              className="button button-danger"
              disabled={busy}
              onClick={() =>
                void Taro.showModal({
                  title: '发起终止投票',
                  content: '在线玩家将在 30 秒内决定继续等待或中止本局。',
                  confirmText: '发起投票',
                }).then((result) => {
                  if (result.confirm)
                    void submitCommand({
                      type: 'StartPauseTerminationVote',
                      payload: {},
                    });
                })
              }
            >
              发起终止投票
            </Button>
          ) : null}
          {terminationChoices.length === 0 ? null : (
            <Button
              className="button"
              disabled={busy}
              onClick={() => {
                dispatchPrivate({
                  type: 'OPEN',
                  action: 'PAUSE_TERMINATION',
                });
              }}
            >
              进入私密终止投票
            </Button>
          )}
        </View>
      ) : null}

      {privateAction === undefined ? null : (
        <View className="private-action-overlay">
          <Text className="title">
            {privateAction === 'TEAM_VOTE'
              ? '私密组队投票'
              : privateAction === 'QUEST'
                ? '私密任务行动'
                : '私密终止投票'}
          </Text>
          <View className="subtitle">
            遮挡屏幕后选择；提交后不会保留你的选择。
          </View>
          {(privateAction === 'TEAM_VOTE'
            ? teamVotes
            : privateAction === 'QUEST'
              ? questChoices
              : terminationChoices
          ).map((choice) => (
            <Button
              key={choice}
              className={`button button-secondary${privateChoice === choice ? ' choice-selected' : ''}`}
              ariaLabel={`${privateChoice === choice ? '已选择，' : ''}${
                choice === 'APPROVE'
                  ? '同意队伍'
                  : choice === 'REJECT'
                    ? '否决队伍'
                    : choice === 'SUCCESS'
                      ? '任务成功'
                      : choice === 'FAIL'
                        ? '任务失败'
                        : choice === 'TERMINATE'
                          ? '中止本局'
                          : '继续等待'
              }`}
              onClick={() => {
                dispatchPrivate({ type: 'SELECT', choice });
              }}
            >
              {choice === 'APPROVE'
                ? '同意队伍'
                : choice === 'REJECT'
                  ? '否决队伍'
                  : choice === 'SUCCESS'
                    ? '任务成功'
                    : choice === 'FAIL'
                      ? '任务失败'
                      : choice === 'TERMINATE'
                        ? '中止本局'
                        : '继续等待'}
            </Button>
          ))}
          <Button
            className="button"
            disabled={privateChoice === undefined || busy}
            onClick={() => {
              const selected = privateChoice;
              if (selected === undefined) return;
              void confirmSecret('确认提交当前选择？提交后不能修改。').then(
                (confirmed) => {
                  if (!confirmed) return;
                  const action = privateAction;
                  dispatchPrivate({ type: 'RESET' });
                  if (action === 'TEAM_VOTE') {
                    void submitCommand({
                      type: 'SubmitTeamVote',
                      payload: { vote: selected as 'APPROVE' | 'REJECT' },
                    }).catch(() => undefined);
                  } else if (action === 'QUEST') {
                    void submitCommand({
                      type: 'SubmitQuestChoice',
                      payload: { choice: selected as 'SUCCESS' | 'FAIL' },
                    }).catch(() => undefined);
                  } else {
                    void submitCommand({
                      type: 'SubmitPauseTerminationVote',
                      payload: {
                        choice: selected as 'CONTINUE_PAUSE' | 'TERMINATE',
                      },
                    }).catch(() => undefined);
                  }
                },
              );
            }}
          >
            二次确认并提交
          </Button>
          <Button
            className="button button-secondary"
            onClick={() => {
              dispatchPrivate({ type: 'RESET' });
            }}
          >
            取消并清空
          </Button>
        </View>
      )}
    </PageShell>
  );
}

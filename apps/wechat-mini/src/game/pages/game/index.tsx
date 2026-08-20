import { Button, Text, Textarea, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';

import { rolePresentation } from '@avalon/client-core';

import { PageShell } from '@/components/page-shell';
import { PlayerList } from '@/components/player-list';
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

const CUE_SUBTITLES: Readonly<Record<string, string>> = {
  'game.role.reveal': '请各位玩家查看并确认自己的身份。',
  'game.team.proposal': '请队长提出本次任务队伍。',
  'game.team.vote': '请所有玩家秘密提交同意或否决。',
  'game.team.approved': '队伍已通过，准备执行任务。',
  'game.team.rejected': '队伍未通过，队长顺位轮换。',
  'game.quest.submission': '请任务队员秘密提交任务行动。',
  'game.quest.success': '本次任务成功。',
  'game.quest.failure': '本次任务失败。',
  'game.assassination': '三次任务成功，请刺客选择梅林。',
};

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

export default function GamePage() {
  const { roomView, submitCommand, pendingCommandType, privacyHidden } =
    useSession();
  const [selectedTeam, setSelectedTeam] = useState<Set<string>>(new Set());
  const [pauseReason, setPauseReason] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => {
    setSelectedTeam(new Set());
    setGuideOpen(false);
  }, [privacyHidden, roomView?.public.stateVersion]);
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
            {CUE_SUBTITLES[cue.audioCueKey] ?? '请根据当前阶段继续游戏。'}
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

      {teamVotes.map((vote) => (
        <Button
          key={vote}
          className={`button${vote === 'REJECT' ? ' button-danger' : ''}`}
          disabled={busy}
          onClick={() =>
            void confirmSecret(
              `确认提交“${vote === 'APPROVE' ? '同意' : '否决'}”？提交后不能修改。`,
            ).then((ok) => {
              if (ok)
                void submitCommand({
                  type: 'SubmitTeamVote',
                  payload: { vote },
                });
            })
          }
        >
          {vote === 'APPROVE' ? '同意队伍' : '否决队伍'}
        </Button>
      ))}

      {questChoices.map((choice) => (
        <Button
          key={choice}
          className={`button${choice === 'FAIL' ? ' button-danger' : ''}`}
          disabled={busy}
          onClick={() =>
            void confirmSecret(
              `确认提交“任务${choice === 'SUCCESS' ? '成功' : '失败'}”？提交后不会再次显示你的选择。`,
            ).then((ok) => {
              if (ok)
                void submitCommand({
                  type: 'SubmitQuestChoice',
                  payload: { choice },
                });
            })
          }
        >
          任务{choice === 'SUCCESS' ? '成功' : '失败'}
        </Button>
      ))}
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
      {roomView.public.phase === 'PAUSED' ? (
        <View className="card">
          <Text className="section-title">对局已暂停</Text>
          <View>原因：{roomView.public.pauseReasons.join('、')}</View>
          {roomView.public.manualPauseReason == null ? null : (
            <View>房主说明：{roomView.public.manualPauseReason}</View>
          )}
          {roomView.public.recoveryExpiresAt == null ? null : (
            <View className="progress">
              最晚恢复：{roomView.public.recoveryExpiresAt}
            </View>
          )}
          {roomView.public.pauseTerminationVote == null ? null : (
            <View className="progress">
              终止投票：{roomView.public.pauseTerminationVote.submittedCount}/
              {roomView.public.pauseTerminationVote.eligibleCount}
            </View>
          )}
        </View>
      ) : null}
      {actions.has('ResumeGame') ? (
        <Button
          className="button"
          disabled={busy}
          onClick={() =>
            void submitCommand({ type: 'ResumeGame', payload: {} })
          }
        >
          恢复对局
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
      {terminationChoices.map((choice) => (
        <Button
          key={choice}
          className={`button${choice === 'TERMINATE' ? ' button-danger' : ''}`}
          disabled={busy}
          onClick={() =>
            void confirmSecret(
              choice === 'TERMINATE'
                ? '确认投票中止本局？'
                : '确认投票继续等待？',
            ).then((ok) => {
              if (ok)
                void submitCommand({
                  type: 'SubmitPauseTerminationVote',
                  payload: { choice },
                });
            })
          }
        >
          {choice === 'TERMINATE' ? '中止本局' : '继续等待'}
        </Button>
      ))}

      {role === undefined ? null : (
        <View className="card">
          <Button
            className="button button-secondary"
            onClick={() => {
              setGuideOpen((open) => !open);
            }}
          >
            {guideOpen ? '关闭本人角色攻略' : '查看本人角色攻略'}
          </Button>
          {guideOpen ? (
            <View>
              <Text className="section-title">{role.label}</Text>
              {role.guide.map((tip) => (
                <View className="subtitle" key={tip}>
                  • {tip}
                </View>
              ))}
            </View>
          ) : null}
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
          <View className="subtitle" key={['proposal', index].join('-')}>
            任务 {record.questIndex} 第 {record.proposalAttempt} 次组队：
            {record.approved ? '通过' : '否决'}（{record.approveCount} 同意 /{' '}
            {record.rejectCount} 否决）
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
    </PageShell>
  );
}

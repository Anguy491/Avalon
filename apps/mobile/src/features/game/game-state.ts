import type { RoomView } from '@avalon/protocol/mobile';

type PlayerSummary = RoomView['public']['players'][number];
type ProposalRecord = RoomView['public']['proposalHistory'][number];
type QuestRecord = RoomView['public']['questHistory'][number];

export interface QuestTrackItem {
  readonly questIndex: number;
  readonly state: 'PENDING' | 'CURRENT' | 'SUCCESS' | 'FAILURE';
  readonly requiredFails?: number;
}

export interface GameTableState {
  readonly phase: RoomView['public']['phase'];
  readonly phaseStage: RoomView['public']['phaseStage'];
  readonly phaseTitle: string;
  readonly selfPlayerId: string;
  readonly isHost: boolean;
  readonly leader?: PlayerSummary;
  readonly players: readonly PlayerSummary[];
  readonly proposedTeam: readonly PlayerSummary[];
  readonly questIndex?: number;
  readonly proposalAttempt: number;
  readonly requiredTeamSize?: number;
  readonly requiredQuestFails?: number;
  readonly questTrack: readonly QuestTrackItem[];
  readonly successCount: number;
  readonly failureCount: number;
  readonly submissionProgress?: {
    readonly submittedCount: number;
    readonly requiredCount: number;
  };
  readonly latestProposal?: ProposalRecord;
  readonly latestQuest?: QuestRecord;
  readonly proposalHistory: readonly ProposalRecord[];
  readonly questHistory: readonly QuestRecord[];
  readonly hasSubmitted: boolean;
  readonly canContinue: boolean;
  readonly canSubmitTeam: boolean;
  readonly allowedTeamVotes: readonly ('APPROVE' | 'REJECT')[];
  readonly allowedQuestChoices: readonly ('SUCCESS' | 'FAIL')[];
  readonly isOnQuestTeam: boolean;
  readonly continueLabel?: string;
  readonly outcomeLabel?: string;
}

const PHASE_LABELS: Readonly<Record<RoomView['public']['phase'], string>> = {
  LOBBY: '房间大厅',
  ROLE_REVEAL: '身份确认',
  TEAM_PROPOSAL: '队长组队',
  TEAM_VOTE: '全员投票',
  QUEST_SUBMISSION: '任务行动',
  QUEST_RESOLUTION: '任务结果',
  ASSASSINATION: '刺杀讨论',
  GAME_OVER: '对局结束',
  PAUSED: '对局暂停',
};

const OUTCOME_LABELS: Partial<
  Record<NonNullable<RoomView['public']['gameOutcome']>['reason'], string>
> = {
  FIVE_REJECTED_TEAMS: '同一任务连续五次组队被否决，邪恶方获胜。',
  THREE_QUEST_FAILURES: '三项任务失败，邪恶方获胜。',
  MERLIN_ASSASSINATED: '梅林被刺杀，邪恶方获胜。',
  MERLIN_SURVIVED: '梅林幸存，善良方获胜。',
  ABORTED: '对局已中止，不判定阵营胜负。',
};

function action(
  roomView: RoomView,
  commandType: RoomView['private']['availableActions'][number]['commandType'],
) {
  return roomView.private.availableActions.find(
    (candidate) => candidate.commandType === commandType,
  );
}

function continueLabel(
  roomView: RoomView,
  latestProposal: ProposalRecord | undefined,
): string | undefined {
  if (action(roomView, 'ContinuePhase') === undefined) return undefined;
  switch (roomView.public.phase) {
    case 'TEAM_PROPOSAL':
      return '开放队长组队';
    case 'TEAM_VOTE':
      if (roomView.public.phaseStage === 'HOST_HELD') return '开始全员投票';
      if (roomView.public.gameOutcome !== null) return '查看终局摘要';
      return latestProposal?.approved === true
        ? '继续到任务行动'
        : '开始下一次组队';
    case 'QUEST_SUBMISSION':
      return '开放任务行动';
    case 'QUEST_RESOLUTION':
      if (roomView.public.gameOutcome !== null) return '查看终局摘要';
      return roomView.public.successCount === 3
        ? '继续到刺杀讨论'
        : '开始下一项任务';
    case 'ASSASSINATION':
      return '开放刺杀选择';
    default:
      return '继续';
  }
}

export function deriveGameTableState(roomView: RoomView): GameTableState {
  const players = [...roomView.public.players].sort(
    (left, right) => left.seat - right.seat,
  );
  const byId = new Map(players.map((player) => [player.playerId, player]));
  const latestProposal = roomView.public.proposalHistory.at(-1);
  const latestQuest = roomView.public.questHistory.at(-1);
  const voteAction = action(roomView, 'SubmitTeamVote');
  const questAction = action(roomView, 'SubmitQuestChoice');
  const settledByQuest = new Map(
    roomView.public.questHistory.map((record) => [record.questIndex, record]),
  );
  const questTrack = Array.from({ length: 5 }, (_, index): QuestTrackItem => {
    const questIndex = index + 1;
    const settled = settledByQuest.get(questIndex);
    if (settled !== undefined) {
      return {
        questIndex,
        state: settled.result === 'SUCCESS' ? 'SUCCESS' : 'FAILURE',
        requiredFails: settled.requiredFails,
      };
    }
    if (
      roomView.public.questIndex === questIndex &&
      roomView.public.phase !== 'GAME_OVER'
    ) {
      return {
        questIndex,
        state: 'CURRENT',
        ...(roomView.public.requiredQuestFails === null
          ? {}
          : { requiredFails: roomView.public.requiredQuestFails }),
      };
    }
    return { questIndex, state: 'PENDING' };
  });
  const self = byId.get(roomView.private.playerId);
  const outcome = roomView.public.gameOutcome;
  const leader =
    roomView.public.leaderPlayerId === null ||
    roomView.public.leaderPlayerId === undefined
      ? undefined
      : byId.get(roomView.public.leaderPlayerId);
  const allowedTeamVotes = (voteAction?.allowedTeamVotes ?? []).filter(
    (vote): vote is 'APPROVE' | 'REJECT' =>
      vote === 'APPROVE' || vote === 'REJECT',
  );
  const allowedQuestChoices = (questAction?.allowedQuestChoices ?? []).filter(
    (choice): choice is 'SUCCESS' | 'FAIL' =>
      choice === 'SUCCESS' || choice === 'FAIL',
  );
  const nextContinueLabel = continueLabel(roomView, latestProposal);

  return {
    phase: roomView.public.phase,
    phaseStage: roomView.public.phaseStage,
    phaseTitle: PHASE_LABELS[roomView.public.phase] ?? '对局',
    selfPlayerId: roomView.private.playerId,
    isHost: self?.isHost === true,
    ...(leader === undefined ? {} : { leader }),
    players,
    proposedTeam: roomView.public.proposedTeamPlayerIds.flatMap((playerId) => {
      const player = byId.get(playerId);
      return player === undefined ? [] : [player];
    }),
    ...(roomView.public.questIndex === null ||
    roomView.public.questIndex === undefined
      ? {}
      : { questIndex: roomView.public.questIndex }),
    proposalAttempt: roomView.public.proposalAttempt,
    ...(roomView.public.requiredTeamSize === null ||
    roomView.public.requiredTeamSize === undefined
      ? {}
      : { requiredTeamSize: roomView.public.requiredTeamSize }),
    ...(roomView.public.requiredQuestFails === null
      ? {}
      : { requiredQuestFails: roomView.public.requiredQuestFails }),
    questTrack,
    successCount: roomView.public.successCount,
    failureCount: roomView.public.failureCount,
    ...(roomView.public.submissionProgress === null ||
    roomView.public.submissionProgress === undefined
      ? {}
      : { submissionProgress: roomView.public.submissionProgress }),
    ...(latestProposal === undefined ? {} : { latestProposal }),
    ...(latestQuest === undefined ? {} : { latestQuest }),
    proposalHistory: roomView.public.proposalHistory,
    questHistory: roomView.public.questHistory,
    hasSubmitted: roomView.private.hasSubmitted,
    canContinue: action(roomView, 'ContinuePhase') !== undefined,
    canSubmitTeam: action(roomView, 'SubmitTeam') !== undefined,
    allowedTeamVotes,
    allowedQuestChoices,
    isOnQuestTeam: roomView.public.proposedTeamPlayerIds.includes(
      roomView.private.playerId,
    ),
    ...(nextContinueLabel === undefined
      ? {}
      : { continueLabel: nextContinueLabel }),
    ...(outcome === null || outcome === undefined
      ? {}
      : { outcomeLabel: OUTCOME_LABELS[outcome.reason] ?? '对局已结束。' }),
  };
}

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
  readonly continueAction?: GameContinueAction;
  readonly outcomeReason?: NonNullable<
    RoomView['public']['gameOutcome']
  >['reason'];
}

export type GameContinueAction =
  | 'OPEN_TEAM_PROPOSAL'
  | 'START_TEAM_VOTE'
  | 'VIEW_RESULT'
  | 'CONTINUE_TO_QUEST'
  | 'START_NEXT_PROPOSAL'
  | 'OPEN_QUEST'
  | 'CONTINUE_TO_ASSASSINATION'
  | 'START_NEXT_QUEST'
  | 'OPEN_ASSASSINATION'
  | 'CONTINUE';

function action(
  roomView: RoomView,
  commandType: RoomView['private']['availableActions'][number]['commandType'],
) {
  return roomView.private.availableActions.find(
    (candidate) => candidate.commandType === commandType,
  );
}

function continueAction(
  roomView: RoomView,
  latestProposal: ProposalRecord | undefined,
): GameContinueAction | undefined {
  if (action(roomView, 'ContinuePhase') === undefined) return undefined;
  switch (roomView.public.phase) {
    case 'TEAM_PROPOSAL':
      return 'OPEN_TEAM_PROPOSAL';
    case 'TEAM_VOTE':
      if (roomView.public.phaseStage === 'HOST_HELD') return 'START_TEAM_VOTE';
      if (roomView.public.gameOutcome !== null) return 'VIEW_RESULT';
      return latestProposal?.approved === true
        ? 'CONTINUE_TO_QUEST'
        : 'START_NEXT_PROPOSAL';
    case 'QUEST_SUBMISSION':
      return 'OPEN_QUEST';
    case 'QUEST_RESOLUTION':
      if (roomView.public.gameOutcome !== null) return 'VIEW_RESULT';
      return roomView.public.successCount === 3
        ? 'CONTINUE_TO_ASSASSINATION'
        : 'START_NEXT_QUEST';
    case 'ASSASSINATION':
      return 'OPEN_ASSASSINATION';
    default:
      return 'CONTINUE';
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
  const nextContinueAction = continueAction(roomView, latestProposal);

  return {
    phase: roomView.public.phase,
    phaseStage: roomView.public.phaseStage,
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
    ...(nextContinueAction === undefined
      ? {}
      : { continueAction: nextContinueAction }),
    ...(outcome === null || outcome === undefined
      ? {}
      : { outcomeReason: outcome.reason }),
  };
}

import { alignmentForRole, requiredFails, requiredTeamSize } from './rules.js';
import type {
  GameState,
  PrivatePlayerState,
  PublicGameState,
} from './types.js';

function leaderPlayerId(state: GameState): string {
  const leader = state.players.find(
    (player) => player.seat === state.leaderSeatIndex,
  );
  if (leader === undefined) throw new RangeError('Leader seat has no player');
  return leader.playerId;
}

export function buildPublicGameState(state: GameState): PublicGameState {
  const effectivePhase =
    state.phase === 'PAUSED' ? state.resumePoint?.phase : state.phase;
  const submissionProgress =
    effectivePhase === 'ROLE_REVEAL'
      ? {
          submittedCount: state.roleAcknowledgements.length,
          requiredCount: state.players.length,
        }
      : effectivePhase === 'TEAM_VOTE'
        ? {
            submittedCount: Object.keys(state.teamVotes).length,
            requiredCount: state.players.length,
          }
        : effectivePhase === 'QUEST_SUBMISSION'
          ? {
              submittedCount: Object.keys(state.questChoices).length,
              requiredCount: state.proposedTeam.length,
            }
          : undefined;

  return {
    stateVersion: state.stateVersion,
    phase: state.phase,
    phaseStage: state.phaseStage,
    leaderPlayerId: leaderPlayerId(state),
    questIndex: state.questIndex,
    proposalAttempt: state.proposalAttempt,
    requiredTeamSize: requiredTeamSize(
      state.config.playerCount,
      state.questIndex,
    ),
    requiredQuestFails: requiredFails(
      state.config.playerCount,
      state.questIndex,
    ),
    proposedTeam: state.proposedTeam,
    ...(submissionProgress === undefined ? {} : { submissionProgress }),
    proposalHistory: state.proposalHistory,
    questHistory: state.questHistory,
    successCount: state.successCount,
    failureCount: state.failureCount,
    pauseReasons: state.pauseReasons,
    ...(state.manualPauseReason === undefined
      ? {}
      : { manualPauseReason: state.manualPauseReason }),
    ...(state.recoveryStartedAt === undefined
      ? {}
      : { recoveryStartedAt: state.recoveryStartedAt }),
    ...(state.recoveryExpiresAt === undefined
      ? {}
      : { recoveryExpiresAt: state.recoveryExpiresAt }),
    ...(state.currentAudioCue === undefined
      ? {}
      : {
          currentAudioCue: {
            audioCueId: state.currentAudioCue.audioCueId,
            audioCueKey: state.currentAudioCue.audioCueKey,
            subtitleKey: state.currentAudioCue.subtitleKey,
            voicePackVersion: state.currentAudioCue.voicePackVersion,
          },
        }),
    ...(state.gameOutcome === undefined
      ? {}
      : { gameOutcome: state.gameOutcome }),
    revealedAssignments:
      state.phase === 'GAME_OVER'
        ? state.players.map((player) => {
            const roleId = state.roleAssignments[player.playerId];
            if (roleId === undefined)
              throw new RangeError('Player has no role');
            return {
              playerId: player.playerId,
              roleId,
              alignment: alignmentForRole(roleId),
            };
          })
        : [],
  };
}

export function buildPrivatePlayerState(
  state: GameState,
  playerId: string,
): PrivatePlayerState {
  if (!state.players.some((player) => player.playerId === playerId)) {
    throw new RangeError('Unknown player');
  }
  const roleId = state.roleAssignments[playerId];
  const knowledge = state.privateKnowledge[playerId];
  const effectivePhase =
    state.phase === 'PAUSED' ? state.resumePoint?.phase : state.phase;
  const hasSubmitted =
    effectivePhase === 'ROLE_REVEAL'
      ? state.roleAcknowledgements.includes(playerId)
      : effectivePhase === 'TEAM_VOTE'
        ? state.teamVotes[playerId] !== undefined
        : effectivePhase === 'QUEST_SUBMISSION'
          ? state.questChoices[playerId] !== undefined
          : false;

  return {
    playerId,
    ...(roleId === undefined
      ? {}
      : { selfRole: roleId, selfAlignment: alignmentForRole(roleId) }),
    knownPlayers: knowledge?.knownPlayers ?? [],
    hasSubmitted,
  };
}

import {
  alignmentForRole,
  requiredTeamSize,
  validateRoleDeck,
} from './rules.js';
import type { GameState } from './types.js';

function hasExactlySeatsFromZero(state: GameState): boolean {
  const seats = state.players
    .map((player) => player.seat)
    .sort((a, b) => a - b);
  return seats.every((seat, index) => seat === index);
}

export function collectInvariantViolations(
  state: GameState,
): readonly string[] {
  const violations: string[] = [];
  const playerIds = new Set(state.players.map((player) => player.playerId));

  if (state.players.length > state.config.playerCount) {
    violations.push('players exceed configured capacity');
  }
  if (
    !hasExactlySeatsFromZero(state) ||
    playerIds.size !== state.players.length
  ) {
    violations.push('players must occupy unique contiguous seats');
  }
  if (!playerIds.has(state.hostPlayerId)) {
    violations.push('host must be a player');
  }
  if (
    state.leaderSeatIndex < 0 ||
    state.leaderSeatIndex >= state.players.length
  ) {
    violations.push('leader seat must identify a player');
  }

  if (state.phase !== 'LOBBY') {
    if (state.players.length !== state.config.playerCount) {
      violations.push('active games require the configured player count');
    }
    if (
      Object.keys(state.roleAssignments).length !== state.players.length ||
      state.players.some(
        (player) => state.roleAssignments[player.playerId] === undefined,
      )
    ) {
      violations.push('active games require exactly one role per player');
    } else {
      const roles = state.players.map((player) => {
        const role = state.roleAssignments[player.playerId];
        if (role === undefined) throw new RangeError('role disappeared');
        return role;
      });
      if (validateRoleDeck(state.config.playerCount, roles).length > 0) {
        violations.push(
          'assigned roles must preserve the configured alignment table',
        );
      }
      if (
        [...roles].sort().join('|') !==
        [...state.config.roleIds].sort().join('|')
      ) {
        violations.push(
          'assigned roles must preserve the configured role deck',
        );
      }
    }
  }

  if (new Set(state.proposedTeam).size !== state.proposedTeam.length) {
    violations.push('proposed team members must be unique');
  }
  if (state.proposedTeam.some((playerId) => !playerIds.has(playerId))) {
    violations.push('proposed team members must belong to the game');
  }
  if (
    state.proposedTeam.length > 0 &&
    (state.phase === 'TEAM_PROPOSAL' ||
      state.phase === 'TEAM_VOTE' ||
      state.phase === 'QUEST_SUBMISSION' ||
      (state.phase === 'PAUSED' &&
        (state.resumePoint?.phase === 'TEAM_PROPOSAL' ||
          state.resumePoint?.phase === 'TEAM_VOTE' ||
          state.resumePoint?.phase === 'QUEST_SUBMISSION'))) &&
    state.proposedTeam.length !==
      requiredTeamSize(state.config.playerCount, state.questIndex)
  ) {
    violations.push('proposed team must match the rule table');
  }
  if (
    Object.keys(state.teamVotes).some((playerId) => !playerIds.has(playerId))
  ) {
    violations.push('team votes may only be keyed by players');
  }
  if (
    Object.keys(state.questChoices).some(
      (playerId) => !state.proposedTeam.includes(playerId),
    )
  ) {
    violations.push('quest choices may only be keyed by approved team members');
  }
  for (const [playerId, choice] of Object.entries(state.questChoices)) {
    const role = state.roleAssignments[playerId];
    if (
      choice === 'FAIL' &&
      role !== undefined &&
      alignmentForRole(role) === 'GOOD'
    ) {
      violations.push('good players can never submit FAIL');
    }
  }

  if (state.successCount + state.failureCount !== state.questHistory.length) {
    violations.push('score must equal settled quest count');
  }
  if (state.successCount > 3 || state.failureCount > 3) {
    violations.push('score cannot exceed a terminal boundary');
  }
  if (state.questHistory.length > 5) {
    violations.push('at most five quests may settle');
  }
  if (
    state.questHistory.some((record) =>
      Object.keys(record).some(
        (key) => key === 'questChoices' || key === 'choicesByPlayer',
      ),
    )
  ) {
    violations.push('quest history cannot retain action ownership');
  }

  if (state.phase === 'PAUSED') {
    if (state.pauseReasons.length === 0 || state.resumePoint === undefined) {
      violations.push('paused games require reasons and a resume point');
    }
  } else if (state.resumePoint !== undefined) {
    violations.push('resume point may only exist under the pause overlay');
  }
  if (state.phase === 'GAME_OVER' && state.gameOutcome === undefined) {
    violations.push('GAME_OVER requires a locked outcome');
  }
  return violations;
}

export function assertGameInvariants(state: GameState): void {
  const violations = collectInvariantViolations(state);
  if (violations.length > 0) {
    throw new Error(`Game invariant violation: ${violations.join('; ')}`);
  }
}

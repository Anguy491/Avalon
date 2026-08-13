import { describe, expect, it } from 'vitest';

import {
  alignmentForRole,
  collectInvariantViolations,
  createInitialGameState,
  executeCommand,
  type EnginePorts,
  type GameState,
} from './index.js';
import {
  accepted,
  command,
  config,
  fixedPorts,
  playerWithRole,
  players,
  settleQuest,
  startAndAcknowledge,
  teamForQuest,
  type TestCommandBody,
} from './__tests__/helpers.js';

interface ValidCommandCase {
  readonly name: string;
  readonly setup: () => {
    readonly state: GameState;
    readonly actor: string;
    readonly body: TestCommandBody;
    readonly ports: EnginePorts;
  };
}

function currentLeader(state: GameState): string {
  return (
    state.players.find((player) => player.seat === state.leaderSeatIndex)
      ?.playerId ?? ''
  );
}

function startHeld() {
  const ports = fixedPorts();
  const initial = createInitialGameState(config(5), players(5));
  const state = accepted(
    initial,
    initial.hostPlayerId,
    { type: 'StartGame' },
    ports,
  );
  return { state, ports };
}

function teamProposalCollecting() {
  const ports = fixedPorts();
  let state = startAndAcknowledge(5, ports);
  state = accepted(state, state.hostPlayerId, { type: 'ContinuePhase' }, ports);
  return { state, ports };
}

function teamVoteCollecting() {
  const prepared = teamProposalCollecting();
  let { state } = prepared;
  state = accepted(
    state,
    currentLeader(state),
    { type: 'SubmitTeam', teamPlayerIds: teamForQuest(state) },
    prepared.ports,
  );
  state = accepted(
    state,
    state.hostPlayerId,
    { type: 'ContinuePhase' },
    prepared.ports,
  );
  return { state, ports: prepared.ports };
}

function questCollecting() {
  const ports = fixedPorts();
  let state = startAndAcknowledge(5, ports);
  const team = teamForQuest(state);
  state = accepted(state, state.hostPlayerId, { type: 'ContinuePhase' }, ports);
  state = accepted(
    state,
    currentLeader(state),
    { type: 'SubmitTeam', teamPlayerIds: team },
    ports,
  );
  state = accepted(state, state.hostPlayerId, { type: 'ContinuePhase' }, ports);
  for (const player of state.players) {
    state = accepted(
      state,
      player.playerId,
      { type: 'SubmitTeamVote', vote: 'APPROVE' },
      ports,
    );
  }
  state = accepted(state, state.hostPlayerId, { type: 'ContinuePhase' }, ports);
  state = accepted(state, state.hostPlayerId, { type: 'ContinuePhase' }, ports);
  return { state, ports };
}

function assassinationCollecting() {
  const ports = fixedPorts();
  let state = startAndAcknowledge(5, ports);
  for (let quest = 0; quest < 3; quest += 1) {
    state = settleQuest(state, teamForQuest(state), new Set(), ports);
    if (quest < 2) {
      state = accepted(
        state,
        state.hostPlayerId,
        { type: 'ContinuePhase' },
        ports,
      );
    }
  }
  state = accepted(state, state.hostPlayerId, { type: 'ContinuePhase' }, ports);
  state = accepted(state, state.hostPlayerId, { type: 'ContinuePhase' }, ports);
  return { state, ports };
}

const cases: readonly ValidCommandCase[] = [
  {
    name: 'StartGame',
    setup: () => {
      const ports = fixedPorts();
      const state = createInitialGameState(config(5), players(5));
      return {
        state,
        actor: state.hostPlayerId,
        body: { type: 'StartGame' },
        ports,
      };
    },
  },
  {
    name: 'ContinuePhase',
    setup: () => {
      const { state, ports } = startHeld();
      return {
        state,
        actor: state.hostPlayerId,
        body: { type: 'ContinuePhase' },
        ports,
      };
    },
  },
  {
    name: 'AckRole',
    setup: () => {
      const held = startHeld();
      const state = accepted(
        held.state,
        held.state.hostPlayerId,
        { type: 'ContinuePhase' },
        held.ports,
      );
      return {
        state,
        actor: 'player-2',
        body: { type: 'AckRole' },
        ports: held.ports,
      };
    },
  },
  {
    name: 'SubmitTeam',
    setup: () => {
      const { state, ports } = teamProposalCollecting();
      return {
        state,
        actor: currentLeader(state),
        body: { type: 'SubmitTeam', teamPlayerIds: teamForQuest(state) },
        ports,
      };
    },
  },
  {
    name: 'SubmitTeamVote',
    setup: () => {
      const { state, ports } = teamVoteCollecting();
      return {
        state,
        actor: 'player-2',
        body: { type: 'SubmitTeamVote', vote: 'APPROVE' },
        ports,
      };
    },
  },
  {
    name: 'SubmitQuestChoice',
    setup: () => {
      const { state, ports } = questCollecting();
      const actor = state.proposedTeam.find((playerId) => {
        const role = state.roleAssignments[playerId];
        return role !== undefined && alignmentForRole(role) === 'GOOD';
      });
      return {
        state,
        actor: actor ?? '',
        body: { type: 'SubmitQuestChoice', choice: 'SUCCESS' },
        ports,
      };
    },
  },
  {
    name: 'SelectMerlinTarget',
    setup: () => {
      const { state, ports } = assassinationCollecting();
      return {
        state,
        actor: playerWithRole(state, 'ASSASSIN'),
        body: {
          type: 'SelectMerlinTarget',
          targetPlayerId: playerWithRole(state, 'MERLIN'),
        },
        ports,
      };
    },
  },
  {
    name: 'PauseGame',
    setup: () => {
      const ports = fixedPorts();
      const state = startAndAcknowledge(5, ports);
      return {
        state,
        actor: state.hostPlayerId,
        body: { type: 'PauseGame' },
        ports,
      };
    },
  },
  {
    name: 'ResumeGame',
    setup: () => {
      const ports = fixedPorts();
      let state = startAndAcknowledge(5, ports);
      state = accepted(state, state.hostPlayerId, { type: 'PauseGame' }, ports);
      return {
        state,
        actor: state.hostPlayerId,
        body: { type: 'ResumeGame' },
        ports,
      };
    },
  },
  {
    name: 'ReplayAudioCue',
    setup: () => {
      const ports = fixedPorts();
      const state = startAndAcknowledge(5, ports);
      return {
        state,
        actor: state.hostPlayerId,
        body: {
          type: 'ReplayAudioCue',
          audioCueId: state.currentAudioCue?.audioCueId ?? '',
        },
        ports,
      };
    },
  },
];

describe('M1-007 table-driven command contract', () => {
  it.each(cases)(
    '$name covers success, bad actor, stale version, replay, digest conflict, and invariants',
    ({ setup }) => {
      const { state, actor, body, ports } = setup();
      const outsider = executeCommand(
        state,
        command(state, 'outsider', body),
        ports,
      );
      expect(outsider.result).toMatchObject({
        accepted: false,
        errorCode: 'INVALID_TARGET',
      });
      expect(outsider.state).toBe(state);

      const stale = executeCommand(
        state,
        command(state, actor, body, {
          expectedStateVersion: Math.max(0, state.stateVersion - 1),
        }),
        ports,
      );
      if (state.stateVersion > 0) {
        expect(stale.result).toMatchObject({
          accepted: false,
          errorCode: 'STALE_VERSION',
        });
      }

      const valid = command(state, actor, body);
      const first = executeCommand(state, valid, ports);
      expect(first.result).toMatchObject({
        accepted: true,
        idempotentReplay: false,
      });
      expect(first.state.stateVersion).toBe(state.stateVersion + 1);
      expect(collectInvariantViolations(first.state)).toEqual([]);

      const replay = executeCommand(first.state, valid, ports);
      expect(replay.result).toMatchObject({
        accepted: true,
        idempotentReplay: true,
      });
      expect(replay.state).toBe(first.state);
      expect(replay.effects).toEqual([]);

      const conflict = executeCommand(
        first.state,
        { ...valid, requestDigest: `${valid.requestDigest}-conflict` },
        ports,
      );
      expect(conflict.result).toMatchObject({
        accepted: false,
        errorCode: 'DUPLICATE_COMMAND_CONFLICT',
      });
      expect(conflict.state).toBe(first.state);
    },
  );
});

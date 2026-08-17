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
  configInput,
  fixedPorts,
  lobbyState,
  playerWithRole,
  players,
  settleQuest,
  startAndAcknowledge,
  teamForQuest,
  type TestCommandBody,
} from './__tests__/helpers.js';

interface ValidCommandCase {
  readonly name: TestCommandBody['type'];
  readonly setup: () => {
    readonly state: GameState;
    readonly actor: string;
    readonly body: TestCommandBody;
    readonly ports: EnginePorts;
  };
}

function versionedLobby() {
  const ports = fixedPorts();
  const state = accepted(
    lobbyState(5),
    'player-2',
    { type: 'SetReady', ready: false },
    ports,
  );
  return { state, ports };
}

function controllablePorts() {
  let now = '2026-08-13T10:00:00.000Z';
  const base = fixedPorts();
  return {
    ports: {
      ...base,
      clock: { ...base.clock, nowIso: () => now },
    } satisfies EnginePorts,
    setNow: (value: string) => {
      now = value;
    },
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
    name: 'ConfigureRoom',
    setup: () => {
      const { state, ports } = versionedLobby();
      return {
        state,
        actor: state.hostPlayerId,
        body: {
          type: 'ConfigureRoom',
          configInput: configInput(5, 'RECOMMENDED'),
        },
        ports,
      };
    },
  },
  {
    name: 'ReorderSeats',
    setup: () => {
      const { state, ports } = versionedLobby();
      return {
        state,
        actor: state.hostPlayerId,
        body: {
          type: 'ReorderSeats',
          playerIds: state.players
            .map((player) => player.playerId)
            .slice()
            .reverse(),
        },
        ports,
      };
    },
  },
  {
    name: 'SetReady',
    setup: () => {
      const { state, ports } = versionedLobby();
      return {
        state,
        actor: 'player-2',
        body: { type: 'SetReady', ready: true },
        ports,
      };
    },
  },
  {
    name: 'LeaveLobby',
    setup: () => {
      const { state, ports } = versionedLobby();
      return {
        state,
        actor: 'player-2',
        body: { type: 'LeaveLobby' },
        ports,
      };
    },
  },
  {
    name: 'KickLobbyPlayer',
    setup: () => {
      const { state, ports } = versionedLobby();
      return {
        state,
        actor: state.hostPlayerId,
        body: { type: 'KickLobbyPlayer', targetPlayerId: 'player-2' },
        ports,
      };
    },
  },
  {
    name: 'CloseRoom',
    setup: () => {
      const { state, ports } = versionedLobby();
      return {
        state,
        actor: state.hostPlayerId,
        body: { type: 'CloseRoom' },
        ports,
      };
    },
  },
  {
    name: 'StartGame',
    setup: () => {
      const ports = fixedPorts();
      let state = createInitialGameState(config(5), players(5));
      state = accepted(
        state,
        'player-2',
        { type: 'SetReady', ready: false },
        ports,
      );
      state = accepted(
        state,
        'player-2',
        { type: 'SetReady', ready: true },
        ports,
      );
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
    name: 'StartPauseTerminationVote',
    setup: () => {
      const clock = controllablePorts();
      let state = startAndAcknowledge(5, clock.ports);
      state = accepted(
        state,
        state.hostPlayerId,
        { type: 'PauseGame' },
        clock.ports,
      );
      clock.setNow('2026-08-13T10:01:00.000Z');
      return {
        state,
        actor: 'player-2',
        body: { type: 'StartPauseTerminationVote' },
        ports: clock.ports,
      };
    },
  },
  {
    name: 'SubmitPauseTerminationVote',
    setup: () => {
      const clock = controllablePorts();
      let state = startAndAcknowledge(5, clock.ports);
      state = accepted(
        state,
        state.hostPlayerId,
        { type: 'PauseGame' },
        clock.ports,
      );
      clock.setNow('2026-08-13T10:01:00.000Z');
      state = accepted(
        state,
        'player-2',
        { type: 'StartPauseTerminationVote' },
        clock.ports,
      );
      return {
        state,
        actor: 'player-2',
        body: {
          type: 'SubmitPauseTerminationVote',
          choice: 'TERMINATE',
        },
        ports: clock.ports,
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
  it('covers every GameCommand variant exactly once', () => {
    const expected: readonly TestCommandBody['type'][] = [
      'ConfigureRoom',
      'ReorderSeats',
      'SetReady',
      'StartGame',
      'ContinuePhase',
      'AckRole',
      'SubmitTeam',
      'SubmitTeamVote',
      'SubmitQuestChoice',
      'SelectMerlinTarget',
      'PauseGame',
      'ResumeGame',
      'StartPauseTerminationVote',
      'SubmitPauseTerminationVote',
      'ReplayAudioCue',
      'LeaveLobby',
      'KickLobbyPlayer',
      'CloseRoom',
    ];
    expect(cases.map(({ name }) => name).sort()).toEqual([...expected].sort());
    expect(new Set(cases.map(({ name }) => name)).size).toBe(expected.length);
  });

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

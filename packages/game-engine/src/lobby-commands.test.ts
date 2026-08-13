import { describe, expect, it } from 'vitest';

import {
  collectInvariantViolations,
  executeCommand,
  type GameState,
} from './index.js';
import {
  accepted,
  command,
  configInput,
  fixedPorts,
  lobbyState,
  players,
} from './__tests__/helpers.js';

const HOST = 'player-1';

function seatOrder(state: GameState): readonly string[] {
  return state.players
    .slice()
    .sort((left, right) => left.seat - right.seat)
    .map((player) => player.playerId);
}

describe('SM-004 ConfigureRoom', () => {
  it('lets the host replace the config and resets everyone to unready', () => {
    const ports = fixedPorts();
    let state = lobbyState(6);
    state = accepted(state, HOST, { type: 'SetReady', ready: true }, ports);
    state = accepted(
      state,
      'player-2',
      { type: 'SetReady', ready: true },
      ports,
    );
    state = accepted(
      state,
      HOST,
      { type: 'ConfigureRoom', configInput: configInput(6, 'COMMON_ROLES') },
      ports,
    );
    expect(state.config.roleIds).toContain('PERCIVAL');
    expect(state.players.every((player) => !player.ready)).toBe(true);
    expect(collectInvariantViolations(state)).toEqual([]);
  });

  it('rejects a non-host actor', () => {
    const ports = fixedPorts();
    const state = lobbyState(6);
    const result = executeCommand(
      state,
      command(state, 'player-2', {
        type: 'ConfigureRoom',
        configInput: configInput(6),
      }),
      ports,
    );
    expect(result.result).toMatchObject({
      accepted: false,
      errorCode: 'NOT_HOST',
    });
  });

  it('rejects illegal role decks', () => {
    const ports = fixedPorts();
    const state = lobbyState(6);
    const result = executeCommand(
      state,
      command(state, HOST, {
        type: 'ConfigureRoom',
        configInput: {
          rulesVersion: 'CLASSIC_AVALON_V1',
          playerCount: 6,
          roleSelection: { type: 'CUSTOM', roleIds: ['MERLIN', 'MERLIN'] },
          locale: 'zh-CN',
        },
      }),
      ports,
    );
    expect(result.result).toMatchObject({
      accepted: false,
      errorCode: 'INVALID_CONFIG',
    });
  });

  it('rejects a target player count below the current lobby size instead of silently kicking', () => {
    const ports = fixedPorts();
    const state = lobbyState(7);
    const result = executeCommand(
      state,
      command(state, HOST, {
        type: 'ConfigureRoom',
        configInput: configInput(5),
      }),
      ports,
    );
    expect(result.result).toMatchObject({
      accepted: false,
      errorCode: 'INVALID_CONFIG',
    });
    expect(result.state.players).toHaveLength(7);
  });

  it('is only legal in LOBBY', () => {
    const ports = fixedPorts();
    let state = lobbyState(5);
    state = accepted(state, HOST, { type: 'StartGame' }, ports);
    const result = executeCommand(
      state,
      command(state, HOST, {
        type: 'ConfigureRoom',
        configInput: configInput(5),
      }),
      ports,
    );
    expect(result.result).toMatchObject({
      accepted: false,
      errorCode: 'INVALID_PHASE',
    });
  });
});

describe('SM-005 ReorderSeats', () => {
  it('lets the host reorder seats and resets ready state', () => {
    const ports = fixedPorts();
    let state = lobbyState(5);
    state = accepted(
      state,
      'player-2',
      { type: 'SetReady', ready: true },
      ports,
    );
    const newOrder = [
      'player-5',
      'player-4',
      'player-3',
      'player-2',
      'player-1',
    ];
    state = accepted(
      state,
      HOST,
      { type: 'ReorderSeats', playerIds: newOrder },
      ports,
    );
    expect(seatOrder(state)).toEqual(newOrder);
    expect(state.players.every((player) => !player.ready)).toBe(true);
    expect(collectInvariantViolations(state)).toEqual([]);
  });

  it('rejects a non-host actor', () => {
    const ports = fixedPorts();
    const state = lobbyState(5);
    const result = executeCommand(
      state,
      command(state, 'player-2', {
        type: 'ReorderSeats',
        playerIds: players(5)
          .slice()
          .reverse()
          .map((player) => player.playerId),
      }),
      ports,
    );
    expect(result.result).toMatchObject({
      accepted: false,
      errorCode: 'NOT_HOST',
    });
  });

  it.each([
    {
      name: 'missing a player',
      playerIds: ['player-1', 'player-2', 'player-3', 'player-4'],
    },
    {
      name: 'duplicated player',
      playerIds: ['player-1', 'player-1', 'player-3', 'player-4', 'player-5'],
    },
    {
      name: 'extra unknown player',
      playerIds: [
        'player-1',
        'player-2',
        'player-3',
        'player-4',
        'player-5',
        'player-9',
      ],
    },
    {
      name: 'cross-room player id',
      playerIds: [
        'player-1',
        'player-2',
        'player-3',
        'player-4',
        'other-room-player',
      ],
    },
    { name: 'empty list', playerIds: [] },
  ])('rejects seat order: $name', ({ playerIds }) => {
    const ports = fixedPorts();
    const state = lobbyState(5);
    const result = executeCommand(
      state,
      command(state, HOST, { type: 'ReorderSeats', playerIds }),
      ports,
    );
    expect(result.result).toMatchObject({
      accepted: false,
      errorCode: 'INVALID_SEAT_ORDER',
    });
  });

  it('is only legal in LOBBY', () => {
    const ports = fixedPorts();
    let state = lobbyState(5);
    state = accepted(state, HOST, { type: 'StartGame' }, ports);
    const result = executeCommand(
      state,
      command(state, HOST, {
        type: 'ReorderSeats',
        playerIds: players(5).map((player) => player.playerId),
      }),
      ports,
    );
    expect(result.result).toMatchObject({
      accepted: false,
      errorCode: 'INVALID_PHASE',
    });
  });
});

describe('SM-006 SetReady', () => {
  it('lets any player toggle only their own readiness', () => {
    const ports = fixedPorts();
    let state = lobbyState(5);
    // Drive every player to a known, distinguishable ready state first.
    for (const player of state.players) {
      state = accepted(
        state,
        player.playerId,
        { type: 'SetReady', ready: false },
        ports,
      );
    }
    const before = state.players.map((player) => ({ ...player }));
    state = accepted(
      state,
      'player-3',
      { type: 'SetReady', ready: true },
      ports,
    );
    expect(
      state.players.find((player) => player.playerId === 'player-3')?.ready,
    ).toBe(true);
    for (const player of before) {
      if (player.playerId === 'player-3') continue;
      const after = state.players.find(
        (candidate) => candidate.playerId === player.playerId,
      );
      expect(after?.ready).toBe(player.ready);
    }
  });

  it('is only legal in LOBBY', () => {
    const ports = fixedPorts();
    let state = lobbyState(5);
    state = accepted(state, HOST, { type: 'StartGame' }, ports);
    const result = executeCommand(
      state,
      command(state, 'player-2', { type: 'SetReady', ready: true }),
      ports,
    );
    expect(result.result).toMatchObject({
      accepted: false,
      errorCode: 'INVALID_PHASE',
    });
  });
});

describe('SM-017 LeaveLobby', () => {
  it('removes the player, compresses seats, resets ready, and requests session revocation', () => {
    const ports = fixedPorts();
    let state = lobbyState(6);
    state = accepted(
      state,
      'player-3',
      { type: 'SetReady', ready: true },
      ports,
    );
    const transition = executeCommand(
      state,
      command(state, 'player-2', { type: 'LeaveLobby' }),
      ports,
    );
    expect(transition.result.accepted).toBe(true);
    expect(transition.effects).toEqual([
      { type: 'SESSION_REVOKE_REQUESTED', playerId: 'player-2' },
    ]);
    expect(transition.state.players).toHaveLength(5);
    expect(seatOrder(transition.state)).toEqual([
      'player-1',
      'player-3',
      'player-4',
      'player-5',
      'player-6',
    ]);
    expect(transition.state.players.every((player) => !player.ready)).toBe(
      true,
    );
    expect(collectInvariantViolations(transition.state)).toEqual([]);
  });

  it('forbids the host from leaving', () => {
    const ports = fixedPorts();
    const state = lobbyState(5);
    const result = executeCommand(
      state,
      command(state, HOST, { type: 'LeaveLobby' }),
      ports,
    );
    expect(result.result).toMatchObject({
      accepted: false,
      errorCode: 'HOST_CANNOT_LEAVE',
    });
  });

  it('is only legal in LOBBY', () => {
    const ports = fixedPorts();
    let state = lobbyState(5);
    state = accepted(state, HOST, { type: 'StartGame' }, ports);
    const result = executeCommand(
      state,
      command(state, 'player-2', { type: 'LeaveLobby' }),
      ports,
    );
    expect(result.result).toMatchObject({
      accepted: false,
      errorCode: 'INVALID_PHASE',
    });
  });
});

describe('SM-018 KickLobbyPlayer', () => {
  it('removes the target, compresses seats, resets ready, and requests session revocation', () => {
    const ports = fixedPorts();
    const state = lobbyState(6);
    const transition = executeCommand(
      state,
      command(state, HOST, {
        type: 'KickLobbyPlayer',
        targetPlayerId: 'player-4',
      }),
      ports,
    );
    expect(transition.result.accepted).toBe(true);
    expect(transition.effects).toEqual([
      { type: 'SESSION_REVOKE_REQUESTED', playerId: 'player-4' },
    ]);
    expect(seatOrder(transition.state)).toEqual([
      'player-1',
      'player-2',
      'player-3',
      'player-5',
      'player-6',
    ]);
    expect(collectInvariantViolations(transition.state)).toEqual([]);
  });

  it('rejects a non-host actor', () => {
    const ports = fixedPorts();
    const state = lobbyState(5);
    const result = executeCommand(
      state,
      command(state, 'player-2', {
        type: 'KickLobbyPlayer',
        targetPlayerId: 'player-3',
      }),
      ports,
    );
    expect(result.result).toMatchObject({
      accepted: false,
      errorCode: 'NOT_HOST',
    });
  });

  it('rejects kicking the host', () => {
    const ports = fixedPorts();
    const state = lobbyState(5);
    const result = executeCommand(
      state,
      command(state, HOST, {
        type: 'KickLobbyPlayer',
        targetPlayerId: HOST,
      }),
      ports,
    );
    expect(result.result).toMatchObject({
      accepted: false,
      errorCode: 'INVALID_TARGET',
    });
  });

  it('rejects a nonexistent or cross-room target', () => {
    const ports = fixedPorts();
    const state = lobbyState(5);
    const result = executeCommand(
      state,
      command(state, HOST, {
        type: 'KickLobbyPlayer',
        targetPlayerId: 'other-room-player',
      }),
      ports,
    );
    expect(result.result).toMatchObject({
      accepted: false,
      errorCode: 'INVALID_TARGET',
    });
  });

  it('is only legal in LOBBY', () => {
    const ports = fixedPorts();
    let state = lobbyState(5);
    state = accepted(state, HOST, { type: 'StartGame' }, ports);
    const result = executeCommand(
      state,
      command(state, HOST, {
        type: 'KickLobbyPlayer',
        targetPlayerId: 'player-2',
      }),
      ports,
    );
    expect(result.result).toMatchObject({
      accepted: false,
      errorCode: 'INVALID_PHASE',
    });
  });
});

describe('SM-019 CloseRoom', () => {
  it('lets the host close the room and requests room deletion', () => {
    const ports = fixedPorts();
    const state = lobbyState(5);
    const transition = executeCommand(
      state,
      command(state, HOST, { type: 'CloseRoom' }),
      ports,
    );
    expect(transition.result.accepted).toBe(true);
    expect(transition.effects).toEqual([{ type: 'ROOM_CLOSE_REQUESTED' }]);
  });

  it('rejects a non-host actor', () => {
    const ports = fixedPorts();
    const state = lobbyState(5);
    const result = executeCommand(
      state,
      command(state, 'player-2', { type: 'CloseRoom' }),
      ports,
    );
    expect(result.result).toMatchObject({
      accepted: false,
      errorCode: 'NOT_HOST',
    });
  });

  it('is only legal in LOBBY', () => {
    const ports = fixedPorts();
    let state = lobbyState(5);
    state = accepted(state, HOST, { type: 'StartGame' }, ports);
    const result = executeCommand(
      state,
      command(state, HOST, { type: 'CloseRoom' }),
      ports,
    );
    expect(result.result).toMatchObject({
      accepted: false,
      errorCode: 'INVALID_PHASE',
    });
  });
});

describe('lobby commands: idempotency and version semantics', () => {
  it('replays the same accepted result for a retried commandId with identical payload', () => {
    const ports = fixedPorts();
    const state = lobbyState(5);
    const cmd = command(state, 'player-2', { type: 'SetReady', ready: true });
    const first = executeCommand(state, cmd, ports);
    const second = executeCommand(first.state, cmd, ports);
    expect(second.result).toEqual({
      accepted: true,
      stateVersion: first.result.accepted
        ? first.result.stateVersion
        : undefined,
      idempotentReplay: true,
    });
  });

  it('rejects a retried commandId with a different payload', () => {
    const ports = fixedPorts();
    const state = lobbyState(5);
    const cmd = command(state, 'player-2', { type: 'SetReady', ready: true });
    const first = executeCommand(state, cmd, ports);
    const conflicting = executeCommand(
      first.state,
      {
        ...cmd,
        requestDigest: 'different-digest',
      },
      ports,
    );
    expect(conflicting.result).toMatchObject({
      accepted: false,
      errorCode: 'DUPLICATE_COMMAND_CONFLICT',
    });
  });

  it('rejects a stale expectedStateVersion without mutating state', () => {
    const ports = fixedPorts();
    const state = lobbyState(5);
    const result = executeCommand(
      state,
      command(
        state,
        'player-2',
        { type: 'SetReady', ready: true },
        { expectedStateVersion: state.stateVersion + 5 },
      ),
      ports,
    );
    expect(result.result).toMatchObject({
      accepted: false,
      errorCode: 'STALE_VERSION',
    });
    expect(result.state).toEqual(state);
  });
});

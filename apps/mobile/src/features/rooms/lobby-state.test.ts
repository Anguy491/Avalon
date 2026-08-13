import { describe, expect, it } from 'vitest';

import type { RoomView } from '@avalon/protocol/mobile';

import {
  configInputFromDraft,
  deriveLobbyUiState,
  initialLobbyConfigDraft,
  isConfigDraftStructurallySubmittable,
  lobbyConfigReducer,
  seatOrderReducer,
} from './lobby-state';

const player = (
  playerId: string,
  seat: number,
  isHost: boolean,
  ready = false,
) => ({
  playerId,
  nickname: `Player ${String(seat + 1)}`,
  seat,
  isHost,
  ready,
  connected: true,
});

const roomView = (
  availableActions: RoomView['private']['availableActions'],
): RoomView =>
  ({
    public: {
      players: [player('player-b', 1, false), player('player-a', 0, true)],
      config: {
        rulesVersion: 'CLASSIC_AVALON_V1',
        playerCount: 5,
        roleIds: [
          'MERLIN',
          'LOYAL_SERVANT',
          'LOYAL_SERVANT',
          'ASSASSIN',
          'MINION',
        ],
        locale: 'zh-CN',
        voicePackVersion: 'zh-CN-v1',
      },
    },
    private: {
      playerId: 'player-a',
      availableActions,
    },
  }) as RoomView;

describe('deriveLobbyUiState', () => {
  it('renders seats in server order and derives controls only from availableActions', () => {
    const state = deriveLobbyUiState(
      roomView([
        { commandType: 'SetReady' },
        {
          commandType: 'KickLobbyPlayer',
          eligibleTargetPlayerIds: ['player-b'],
        },
      ]),
    );

    expect(state.players.map((candidate) => candidate.playerId)).toEqual([
      'player-a',
      'player-b',
    ]);
    expect(state.isHost).toBe(true);
    expect([...state.allowedActions]).toEqual(['SetReady', 'KickLobbyPlayer']);
    expect(state.allowedActions.has('ConfigureRoom')).toBe(false);
    expect(
      state.eligibleKickPlayers.map((candidate) => candidate.playerId),
    ).toEqual(['player-b']);
  });
});

describe('seatOrderReducer', () => {
  it('moves one projected player while preserving a complete permutation', () => {
    const initial = { playerIds: ['a', 'b', 'c'] };
    const moved = seatOrderReducer(initial, {
      type: 'move',
      playerId: 'c',
      delta: -1,
    });
    expect(moved.playerIds).toEqual(['a', 'c', 'b']);
    expect(new Set(moved.playerIds)).toEqual(new Set(initial.playerIds));
    expect(
      seatOrderReducer(moved, { type: 'move', playerId: 'a', delta: -1 }),
    ).toBe(moved);
  });
});

describe('lobbyConfigReducer', () => {
  it('starts from the exact projected role list without guessing its preset', () => {
    const draft = initialLobbyConfigDraft(roomView([]).public.config);
    expect(draft.mode).toBe('CUSTOM');
    expect(configInputFromDraft(draft).roleSelection).toEqual({
      type: 'CUSTOM',
      roleIds: [
        'MERLIN',
        'LOYAL_SERVANT',
        'LOYAL_SERVANT',
        'ASSASSIN',
        'MINION',
      ],
    });
    expect(isConfigDraftStructurallySubmittable(draft)).toBe(true);
  });

  it('performs structural drafting only and leaves role legality to the server', () => {
    const initial = initialLobbyConfigDraft(roomView([]).public.config);
    const short = lobbyConfigReducer(initial, {
      type: 'adjust-role-count',
      roleId: 'LOYAL_SERVANT',
      delta: -1,
    });
    const shorter = lobbyConfigReducer(short, {
      type: 'adjust-role-count',
      roleId: 'LOYAL_SERVANT',
      delta: -1,
    });
    expect(isConfigDraftStructurallySubmittable(shorter)).toBe(false);

    const preset = lobbyConfigReducer(shorter, {
      type: 'set-mode',
      mode: 'COMMON_ROLES',
    });
    expect(isConfigDraftStructurallySubmittable(preset)).toBe(true);
    expect(configInputFromDraft(preset).roleSelection).toEqual({
      type: 'PRESET',
      presetId: 'COMMON_ROLES',
    });
  });
});

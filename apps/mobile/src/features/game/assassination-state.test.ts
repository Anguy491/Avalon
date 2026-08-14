import { describe, expect, it } from 'vitest';

import type { RoomView } from '@avalon/protocol/mobile';

import { deriveAssassinationState } from './assassination-state';

const playerIds = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
] as const;

function assassinationView(): RoomView {
  return {
    public: {
      roomId: '20000000-0000-4000-8000-000000000001',
      roomCode: '7K3M9Q',
      stateVersion: 42,
      rulesVersion: 'CLASSIC_AVALON_V1',
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
      phase: 'ASSASSINATION',
      phaseStage: 'COLLECTING',
      players: playerIds.map((playerId, seat) => ({
        playerId,
        nickname: `玩家${String(seat + 1)}`,
        seat,
        isHost: seat === 0,
        ready: true,
        connected: true,
      })),
      leaderPlayerId: playerIds[0],
      questIndex: 5,
      proposalAttempt: 1,
      requiredTeamSize: 3,
      requiredQuestFails: 1,
      proposedTeamPlayerIds: [],
      submissionProgress: null,
      proposalHistory: [],
      questHistory: [],
      successCount: 3,
      failureCount: 1,
      pauseReasons: [],
      manualPauseReason: null,
      recoveryStartedAt: null,
      recoveryExpiresAt: null,
      currentAudioCue: null,
      gameOutcome: null,
      revealedAssignments: [],
    },
    private: {
      playerId: playerIds[3],
      selfRole: 'ASSASSIN',
      selfAlignment: 'EVIL',
      knownPlayers: [],
      availableActions: [
        {
          commandType: 'SelectMerlinTarget',
          eligibleTargetPlayerIds: [
            playerIds[0],
            playerIds[1],
            playerIds[2],
            playerIds[4],
          ],
        },
      ],
      hasSubmitted: false,
      shouldPlayAudio: false,
      sessionExpiresAt: '2026-08-14T12:00:00.000Z',
    },
  };
}

describe('M5 assassination projection adapter', () => {
  it('uses every server-projected target without alignment filtering', () => {
    const state = deriveAssassinationState(assassinationView());
    expect(state.canSelectTarget).toBe(true);
    expect(state.targets.map((player) => player.playerId)).toEqual([
      playerIds[0],
      playerIds[1],
      playerIds[2],
      playerIds[4],
    ]);
  });

  it('does not retain candidates when the server omits the private action', () => {
    const view = assassinationView();
    view.private.availableActions = [];
    const state = deriveAssassinationState(view);
    expect(state.canSelectTarget).toBe(false);
    expect(state.targets).toEqual([]);
  });
});

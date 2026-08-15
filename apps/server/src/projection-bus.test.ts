import { describe, expect, it } from 'vitest';

import type { ProjectionDelivery } from './outbox-worker.js';
import { parseProjectionDelivery } from './projection-bus.js';

const delivery: ProjectionDelivery = {
  sessionId: '10000000-0000-4000-8000-000000000001',
  playerId: '10000000-0000-4000-8000-000000000002',
  roomId: '10000000-0000-4000-8000-000000000003',
  eventId: '10000000-0000-4000-8000-000000000004',
  credentialGeneration: 1,
  message: {
    protocolVersion: 1,
    delivery: 'LIVE',
    eventId: '10000000-0000-4000-8000-000000000004',
    roomView: {
      public: {
        roomId: '10000000-0000-4000-8000-000000000003',
        roomCode: '234567',
        stateVersion: 1,
        rulesVersion: 'CLASSIC_AVALON_V1',
        config: {
          rulesVersion: 'CLASSIC_AVALON_V1',
          playerCount: 5,
          roleIds: [
            'MERLIN',
            'ASSASSIN',
            'LOYAL_SERVANT',
            'LOYAL_SERVANT',
            'MINION',
          ],
          locale: 'zh-CN',
          voicePackVersion: 'zh-CN-v1',
        },
        phase: 'LOBBY',
        phaseStage: 'HOST_HELD',
        players: [
          {
            playerId: '10000000-0000-4000-8000-000000000002',
            nickname: 'Arthur',
            seat: 0,
            isHost: true,
            ready: false,
            connected: true,
          },
        ],
        leaderPlayerId: null,
        questIndex: null,
        proposalAttempt: 1,
        requiredTeamSize: null,
        requiredQuestFails: null,
        proposedTeamPlayerIds: [],
        submissionProgress: null,
        proposalHistory: [],
        questHistory: [],
        successCount: 0,
        failureCount: 0,
        pauseReasons: [],
        manualPauseReason: null,
        recoveryStartedAt: null,
        recoveryExpiresAt: null,
        currentAudioCue: null,
        gameOutcome: null,
        revealedAssignments: [],
      },
      private: {
        playerId: '10000000-0000-4000-8000-000000000002',
        selfRole: null,
        selfAlignment: null,
        knownPlayers: [],
        availableActions: [],
        hasSubmitted: false,
        shouldPlayAudio: false,
        sessionExpiresAt: '2026-08-13T12:00:00.000Z',
      },
    },
  },
};

describe('personalized projection bus boundary', () => {
  it('accepts only runtime-valid deliveries with consistent recipient fields', () => {
    expect(parseProjectionDelivery(JSON.stringify(delivery))).toEqual(delivery);
    expect(
      parseProjectionDelivery(
        JSON.stringify({ ...delivery, playerId: delivery.roomId }),
      ),
    ).toBeUndefined();
    expect(
      parseProjectionDelivery(JSON.stringify({ ...delivery, role: 'MERLIN' })),
    ).toBeUndefined();
    expect(
      parseProjectionDelivery(
        JSON.stringify({ ...delivery, credentialGeneration: 0 }),
      ),
    ).toBeUndefined();
    expect(
      parseProjectionDelivery(
        JSON.stringify({
          ...delivery,
          message: { ...delivery.message, unexpected: 'secret' },
        }),
      ),
    ).toBeUndefined();
    expect(parseProjectionDelivery('{')).toBeUndefined();
  });
});

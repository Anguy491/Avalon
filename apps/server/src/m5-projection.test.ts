import { describe, expect, it } from 'vitest';

import type { GameState, RoleId } from '@avalon/game-engine';
import {
  RoomViewMessageSchema,
  createProtocolValidator,
} from '@avalon/protocol';

import { projectRoom } from './room-service.js';

const playerIds = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
] as const;
const roles: readonly RoleId[] = [
  'MERLIN',
  'LOYAL_SERVANT',
  'LOYAL_SERVANT',
  'ASSASSIN',
  'MINION',
];

function assassinationState(): GameState {
  return {
    stateVersion: 40,
    config: {
      rulesVersion: 'CLASSIC_AVALON_V1',
      playerCount: 5,
      roleIds: roles,
      locale: 'zh-CN',
      voicePackVersion: 'zh-CN-v1',
    },
    players: playerIds.map((playerId, seat) => ({
      playerId,
      nickname: `玩家${String(seat + 1)}`,
      seat,
      isHost: seat === 0,
      ready: true,
      connected: true,
    })),
    hostPlayerId: playerIds[0],
    phase: 'ASSASSINATION',
    phaseStage: 'COLLECTING',
    leaderSeatIndex: 0,
    questIndex: 5,
    proposalAttempt: 1,
    proposedTeam: [],
    teamVotes: {},
    questChoices: {},
    roleAcknowledgements: [],
    proposalHistory: [],
    questHistory: [],
    successCount: 3,
    failureCount: 1,
    roleAssignments: Object.fromEntries(
      playerIds.map((playerId, index) => [playerId, roles[index]]),
    ) as Readonly<Record<string, RoleId>>,
    privateKnowledge: Object.fromEntries(
      playerIds.map((playerId) => [playerId, { playerId, knownPlayers: [] }]),
    ),
    pauseReasons: [],
    processedCommands: {},
  };
}

function viewFor(state: GameState, playerId: string) {
  return projectRoom(
    '20000000-0000-4000-8000-000000000001',
    '7K3M9Q',
    state,
    playerId,
    new Date('2026-08-14T12:00:00.000Z'),
    new Date('2026-08-14T11:00:00.000Z'),
    'LIVE',
  );
}

describe('M5 assassination and terminal projections', () => {
  it('SM-022 projects pause-ballot counts publicly and voter eligibility privately', () => {
    const base = assassinationState();
    const paused: GameState = {
      ...base,
      phase: 'PAUSED',
      resumePoint: {
        phase: 'ASSASSINATION',
        phaseStage: 'COLLECTING',
      },
      pauseReasons: ['PLAYER_DISCONNECTED'],
      recoveryStartedAt: '2026-08-14T10:00:00.000Z',
      recoveryExpiresAt: '2026-08-14T11:00:00.000Z',
      pauseTerminationVoteAvailableAt: '2026-08-14T10:01:00.000Z',
      pauseTerminationVote: {
        startedAt: '2026-08-14T10:59:30.000Z',
        expiresAt: '2026-08-14T11:00:30.000Z',
        eligiblePlayerIds: playerIds.slice(0, 4),
        choices: { [playerIds[0]]: 'TERMINATE' },
      },
    };
    const eligible = viewFor(paused, playerIds[1]);
    const submitted = viewFor(paused, playerIds[0]);
    const reconnectedAfterSnapshot = viewFor(paused, playerIds[4]);

    expect(eligible.public.pauseTerminationVote).toEqual({
      startedAt: '2026-08-14T10:59:30.000Z',
      expiresAt: '2026-08-14T11:00:30.000Z',
      eligibleCount: 4,
      submittedCount: 1,
    });
    expect(eligible.private.availableActions).toContainEqual({
      commandType: 'SubmitPauseTerminationVote',
      allowedPauseTerminationChoices: ['TERMINATE', 'CONTINUE_PAUSE'],
    });
    expect(submitted.private.availableActions).not.toContainEqual(
      expect.objectContaining({
        commandType: 'SubmitPauseTerminationVote',
      }),
    );
    expect(
      reconnectedAfterSnapshot.private.availableActions,
    ).not.toContainEqual(
      expect.objectContaining({
        commandType: 'SubmitPauseTerminationVote',
      }),
    );
    expect(JSON.stringify(eligible.public)).not.toContain('choices');
  });

  it('SM-016 enables a matching new LIVE audio instance only for the host', () => {
    const state = assassinationState();
    const withCue: GameState = {
      ...state,
      currentAudioCue: {
        audioCueId: 'cue-live-1',
        audioCueKey: 'game.assassination',
        subtitleKey: 'game.assassination',
        voicePackVersion: 'zh-CN-v1',
        phase: 'ASSASSINATION',
        createdAt: '2026-08-14T12:00:00.000Z',
      },
    };
    const hostLive = projectRoom(
      '20000000-0000-4000-8000-000000000001',
      '7K3M9Q',
      withCue,
      playerIds[0],
      new Date('2026-08-14T12:30:00.000Z'),
      new Date('2026-08-14T12:00:00.000Z'),
      { delivery: 'LIVE', liveAudioCueId: 'cue-live-1' },
    );
    const playerLive = projectRoom(
      '20000000-0000-4000-8000-000000000001',
      '7K3M9Q',
      withCue,
      playerIds[1],
      new Date('2026-08-14T12:30:00.000Z'),
      new Date('2026-08-14T12:00:00.000Z'),
      { delivery: 'LIVE', liveAudioCueId: 'cue-live-1' },
    );
    const hostResync = projectRoom(
      '20000000-0000-4000-8000-000000000001',
      '7K3M9Q',
      withCue,
      playerIds[0],
      new Date('2026-08-14T12:30:00.000Z'),
      new Date('2026-08-14T12:00:00.000Z'),
      'RESYNC',
    );
    expect(hostLive.private.shouldPlayAudio).toBe(true);
    expect(playerLive.private.shouldPlayAudio).toBe(false);
    expect(hostResync.private.shouldPlayAudio).toBe(false);
  });

  it('RULE-017/RULE-018 keeps roles secret and authorizes every non-assassin target', () => {
    const state = assassinationState();
    const assassin = viewFor(state, playerIds[3]);
    const bystander = viewFor(state, playerIds[0]);
    expect(assassin.public.revealedAssignments).toEqual([]);
    expect(assassin.private.availableActions).toEqual([
      {
        commandType: 'SelectMerlinTarget',
        eligibleTargetPlayerIds: [
          playerIds[0],
          playerIds[1],
          playerIds[2],
          playerIds[4],
        ],
      },
    ]);
    expect(bystander.private.availableActions).toEqual([
      { commandType: 'PauseGame' },
    ]);
    expect(
      createProtocolValidator().compile(RoomViewMessageSchema)({
        protocolVersion: 1,
        delivery: 'LIVE',
        eventId: '30000000-0000-4000-8000-000000000001',
        roomView: assassin,
      }),
    ).toBe(true);
  });

  it('RULE-019 reveals all assignments while retaining only anonymous quest history', () => {
    const state = assassinationState();
    const terminal: GameState = {
      ...state,
      stateVersion: 41,
      phase: 'GAME_OVER',
      phaseStage: 'RESOLVED',
      gameOutcome: {
        winner: 'EVIL',
        reason: 'MERLIN_ASSASSINATED',
        assassinationTargetPlayerId: playerIds[0],
      },
    };
    const view = viewFor(terminal, playerIds[0]);
    expect(view.public.revealedAssignments).toHaveLength(5);
    expect(view.public.gameOutcome).toMatchObject({
      winner: 'EVIL',
      reason: 'MERLIN_ASSASSINATED',
      assassinationTargetPlayerId: playerIds[0],
    });
    expect(view.private.availableActions).toEqual([]);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('roleAssignments');
    expect(serialized).not.toContain('privateKnowledge');
    expect(serialized).not.toContain('questChoices');
  });
});

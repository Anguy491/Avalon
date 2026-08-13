import type { Command, RoleId, RoomView } from './index.js';

export const UUIDS = {
  command: '0194f1a2-8d91-7a04-93c9-84b8bf856ca1',
  event: '0194f1a2-8d91-7a04-93c9-84b8bf856ca2',
  room: '8ff09e6e-e191-4c57-89cb-c38d0ca62f93',
  players: [
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000005',
  ],
} as const;

export function roomViewForRole(role: RoleId): RoomView {
  return {
    public: {
      roomId: UUIDS.room,
      roomCode: '7K3M9Q',
      stateVersion: 3,
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
      phase: 'ROLE_REVEAL',
      phaseStage: 'COLLECTING',
      players: UUIDS.players.map((playerId, seat) => ({
        playerId,
        nickname: `Player ${String(seat + 1)}`,
        seat,
        isHost: seat === 0,
        ready: true,
        connected: true,
      })),
      leaderPlayerId: UUIDS.players[0],
      questIndex: 1,
      proposalAttempt: 1,
      requiredTeamSize: 2,
      proposedTeamPlayerIds: [],
      submissionProgress: null,
      proposalHistory: [],
      questHistory: [],
      successCount: 0,
      failureCount: 0,
      pauseReasons: [],
      currentAudioCue: null,
      gameOutcome: null,
      revealedAssignments: [],
    },
    private: {
      playerId: UUIDS.players[0],
      selfRole: role,
      selfAlignment: ['MERLIN', 'LOYAL_SERVANT', 'PERCIVAL'].includes(role)
        ? 'GOOD'
        : 'EVIL',
      knownPlayers: [],
      availableActions: [{ commandType: 'AckRole' }],
      hasSubmitted: false,
      shouldPlayAudio: false,
      sessionExpiresAt: '2026-08-13T12:00:00.000Z',
    },
  };
}

export function lobbyRoomView(forHost: boolean): RoomView {
  const selfIndex = forHost ? 0 : 1;
  return {
    public: {
      roomId: UUIDS.room,
      roomCode: '7K3M9Q',
      stateVersion: 1,
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
      phase: 'LOBBY',
      phaseStage: 'COLLECTING',
      players: UUIDS.players.map((playerId, seat) => ({
        playerId,
        nickname: `Player ${String(seat + 1)}`,
        seat,
        isHost: seat === 0,
        ready: seat !== selfIndex,
        connected: true,
      })),
      leaderPlayerId: null,
      questIndex: null,
      proposalAttempt: 1,
      requiredTeamSize: null,
      proposedTeamPlayerIds: [],
      submissionProgress: null,
      proposalHistory: [],
      questHistory: [],
      successCount: 0,
      failureCount: 0,
      pauseReasons: [],
      currentAudioCue: null,
      gameOutcome: null,
      revealedAssignments: [],
    },
    private: {
      playerId: UUIDS.players[selfIndex],
      selfRole: null,
      selfAlignment: null,
      knownPlayers: [],
      availableActions: forHost
        ? [
            { commandType: 'ConfigureRoom' },
            { commandType: 'ReorderSeats' },
            { commandType: 'SetReady' },
            {
              commandType: 'KickLobbyPlayer',
              eligibleTargetPlayerIds: UUIDS.players.slice(1),
            },
            { commandType: 'CloseRoom' },
          ]
        : [{ commandType: 'SetReady' }, { commandType: 'LeaveLobby' }],
      hasSubmitted: false,
      shouldPlayAudio: false,
      sessionExpiresAt: '2026-08-13T12:00:00.000Z',
    },
  };
}

const baseCommand = {
  commandId: UUIDS.command,
  roomId: UUIDS.room,
  expectedStateVersion: 3,
  sentAt: '2026-08-13T10:15:30.000Z',
} as const;

export const commandFixtures: readonly Command[] = [
  {
    ...baseCommand,
    type: 'ConfigureRoom',
    payload: {
      config: {
        rulesVersion: 'CLASSIC_AVALON_V1',
        playerCount: 5,
        roleSelection: { type: 'PRESET', presetId: 'CLASSIC' },
        locale: 'zh-CN',
      },
    },
  },
  {
    ...baseCommand,
    type: 'ReorderSeats',
    payload: { playerIds: [...UUIDS.players] },
  },
  { ...baseCommand, type: 'SetReady', payload: { ready: true } },
  { ...baseCommand, type: 'StartGame', payload: {} },
  { ...baseCommand, type: 'ContinuePhase', payload: {} },
  { ...baseCommand, type: 'AckRole', payload: {} },
  {
    ...baseCommand,
    type: 'SubmitTeam',
    payload: { teamPlayerIds: UUIDS.players.slice(0, 2) },
  },
  {
    ...baseCommand,
    type: 'SubmitTeamVote',
    payload: { vote: 'APPROVE' },
  },
  {
    ...baseCommand,
    type: 'SubmitQuestChoice',
    payload: { choice: 'SUCCESS' },
  },
  {
    ...baseCommand,
    type: 'SelectMerlinTarget',
    payload: { targetPlayerId: UUIDS.players[1] },
  },
  { ...baseCommand, type: 'PauseGame', payload: { reason: 'break' } },
  { ...baseCommand, type: 'ResumeGame', payload: {} },
  {
    ...baseCommand,
    type: 'ReplayAudioCue',
    payload: { audioCueId: 'cue-occurrence-1' },
  },
  { ...baseCommand, type: 'LeaveLobby', payload: {} },
  {
    ...baseCommand,
    type: 'KickLobbyPlayer',
    payload: { targetPlayerId: UUIDS.players[1] },
  },
  { ...baseCommand, type: 'CloseRoom', payload: {} },
];

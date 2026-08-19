import { describe, expect, it } from 'vitest';

import {
  commandFixtures,
  lobbyRoomView,
  roomViewForRole,
  UUIDS,
} from './contract-fixtures.js';
import {
  CommandSchemaDocument,
  CommandTypeSchema,
  ErrorCodeSchema,
  ErrorSchemaDocument,
  HttpSchemaDocument,
  RoomConfigSchemaDocument,
  RoomViewSchemaDocument,
  TransportSchemaDocument,
  type RoleId,
} from './schemas/index.js';
import { createProtocolValidator, requireSchema } from './validator.js';

const ajv = createProtocolValidator();
const validateCommand = requireSchema(ajv, CommandSchemaDocument.$id);
const validateRoomView = requireSchema(ajv, RoomViewSchemaDocument.$id);
const validateSessionReady = requireSchema(
  ajv,
  `${TransportSchemaDocument.$id}#/$defs/SessionReady`,
);
const validateCreateRoom = requireSchema(
  ajv,
  `${HttpSchemaDocument.$id}#/$defs/CreateRoomRequest`,
);
const validateSessionBootstrap = requireSchema(
  ajv,
  `${HttpSchemaDocument.$id}#/$defs/SessionBootstrap`,
);
const validateError = requireSchema(ajv, ErrorSchemaDocument.$id);
const validateRoomConfig = requireSchema(ajv, RoomConfigSchemaDocument.$id);
const validateRealtimeAuth = requireSchema(
  ajv,
  `${TransportSchemaDocument.$id}#/$defs/RealtimeAuth`,
);
const validateRoomViewMessage = requireSchema(
  ajv,
  `${TransportSchemaDocument.$id}#/$defs/RoomViewMessage`,
);
const validateCommandResult = requireSchema(
  ajv,
  `${TransportSchemaDocument.$id}#/$defs/CommandResult`,
);

const clientCapabilities = {
  protocolVersion: 2,
  platform: 'IOS',
  appVersion: '0.1.0',
  installationId: '20000000-0000-4000-8000-000000000001',
  voicePackVersions: ['zh-CN-v1'],
} as const;

const presetConfig = {
  rulesVersion: 'CLASSIC_AVALON_V1',
  playerCount: 5,
  roleSelection: { type: 'PRESET', presetId: 'CLASSIC' },
  locale: 'zh-CN',
} as const;

const testSessionToken = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg';

describe('TEST-contract / M0-005 command schemas', () => {
  it.each(commandFixtures)('accepts a valid $type command', (command) => {
    expect(
      validateCommand(command),
      JSON.stringify(validateCommand.errors),
    ).toBe(true);
  });

  it.each(commandFixtures)(
    'rejects unknown payload fields for $type',
    (command) => {
      const invalid = {
        ...command,
        payload: { ...command.payload, unexpected: true },
      };
      expect(validateCommand(invalid)).toBe(false);
    },
  );

  it('rejects missing envelope fields, invalid enums, and duplicate teams', () => {
    const [first] = commandFixtures;
    expect(validateCommand({ ...first, commandId: undefined })).toBe(false);
    expect(validateCommand({ ...first, type: 'UnknownCommand' })).toBe(false);
    expect(
      validateCommand({
        ...first,
        type: 'SubmitTeam',
        payload: { teamPlayerIds: [UUIDS.players[0], UUIDS.players[0]] },
      }),
    ).toBe(false);
  });
});

describe('TEST-contract / M3 lobby command and error code drift guard', () => {
  // These literal lists mirror the authoritative unions declared in
  // packages/game-engine/src/types.ts (`GameCommand`, `EngineErrorCode`).
  // game-engine intentionally does not depend on packages/protocol (and vice
  // versa, per ADR-007), so this list is kept in manual sync and this test
  // is the regression guard: if either side gains/loses a member without the
  // other being updated, one of the two assertions below fails.
  const engineCommandTypes = [
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
  ] as const;

  // Subset of ErrorCodeSchema produced by the game engine itself; the
  // remaining ErrorCodeSchema members are transport/session/HTTP-boundary
  // codes raised outside the engine (apps/server, Fastify validation, etc.).
  const engineErrorCodes = [
    'STALE_VERSION',
    'DUPLICATE_COMMAND_CONFLICT',
    'NOT_HOST',
    'NOT_LEADER',
    'NOT_ASSASSIN',
    'INVALID_PHASE',
    'INVALID_PHASE_STAGE',
    'PLAYERS_NOT_READY',
    'PLAYERS_OFFLINE',
    'INVALID_CONFIG',
    'INVALID_SEAT_ORDER',
    'INVALID_TEAM_SIZE',
    'INVALID_TEAM_MEMBER',
    'INVALID_TARGET',
    'PLAYER_NOT_ON_TEAM',
    'GOOD_CANNOT_FAIL',
    'ALREADY_SUBMITTED',
    'HOST_CANNOT_LEAVE',
    'AUDIO_CUE_NOT_FOUND',
    'INVALID_PAUSE_REASON',
    'PAUSE_VOTE_NOT_AVAILABLE',
    'PAUSE_VOTE_NOT_ELIGIBLE',
    'PAUSE_VOTE_CLOSED',
  ] as const;

  function literalsOf(schema: unknown): string[] {
    const anyOf = (schema as { anyOf?: readonly { const?: unknown }[] }).anyOf;
    if (!anyOf) throw new Error('expected a TypeBox literal union schema');
    return anyOf.map((member) => {
      if (typeof member.const !== 'string') {
        throw new Error('expected a string const literal');
      }
      return member.const;
    });
  }

  it('CommandTypeSchema exactly matches the game-engine GameCommand union', () => {
    expect(literalsOf(CommandTypeSchema).sort()).toEqual(
      [...engineCommandTypes].sort(),
    );
  });

  it('ErrorCodeSchema is a superset of the game-engine EngineErrorCode union', () => {
    const declared = new Set(literalsOf(ErrorCodeSchema));
    for (const code of engineErrorCodes) {
      expect(declared.has(code), `missing ErrorCode literal: ${code}`).toBe(
        true,
      );
    }
  });

  it('every lobby command fixture round-trips through CommandSchema', () => {
    const lobbyTypes = new Set([
      'ConfigureRoom',
      'ReorderSeats',
      'SetReady',
      'LeaveLobby',
      'KickLobbyPlayer',
      'CloseRoom',
    ]);
    const covered = new Set(
      commandFixtures
        .filter((command) => lobbyTypes.has(command.type))
        .map((command) => command.type),
    );
    expect(covered).toEqual(lobbyTypes);
  });

  it('rejects a ConfigureRoom with a CUSTOM roleSelection outside role-id bounds', () => {
    const invalid = {
      ...(commandFixtures.find(
        (command) => command.type === 'ConfigureRoom',
      ) as (typeof commandFixtures)[number]),
      payload: {
        config: {
          rulesVersion: 'CLASSIC_AVALON_V1',
          playerCount: 5,
          roleSelection: { type: 'CUSTOM', roleIds: ['MERLIN'] },
          locale: 'zh-CN',
        },
      },
    };
    expect(validateCommand(invalid)).toBe(false);
  });

  it('accepts a ConfigureRoom with a valid CUSTOM roleSelection', () => {
    const valid = {
      ...(commandFixtures.find(
        (command) => command.type === 'ConfigureRoom',
      ) as (typeof commandFixtures)[number]),
      payload: {
        config: {
          rulesVersion: 'CLASSIC_AVALON_V1',
          playerCount: 5,
          roleSelection: {
            type: 'CUSTOM',
            roleIds: [
              'MERLIN',
              'LOYAL_SERVANT',
              'LOYAL_SERVANT',
              'ASSASSIN',
              'MINION',
            ],
          },
          locale: 'zh-CN',
        },
      },
    };
    expect(validateCommand(valid), JSON.stringify(validateCommand.errors)).toBe(
      true,
    );
  });

  it('rejects a ReorderSeats payload with duplicate playerIds', () => {
    const invalid = {
      ...(commandFixtures.find(
        (command) => command.type === 'ReorderSeats',
      ) as (typeof commandFixtures)[number]),
      payload: { playerIds: [UUIDS.players[0], UUIDS.players[0]] },
    };
    expect(validateCommand(invalid)).toBe(false);
  });

  it('rejects a SetReady payload missing the ready flag', () => {
    const invalid = {
      ...(commandFixtures.find(
        (command) => command.type === 'SetReady',
      ) as (typeof commandFixtures)[number]),
      payload: {},
    };
    expect(validateCommand(invalid)).toBe(false);
  });

  it('rejects LeaveLobby/CloseRoom payloads carrying unexpected fields', () => {
    for (const type of ['LeaveLobby', 'CloseRoom'] as const) {
      const fixture = commandFixtures.find(
        (command) => command.type === type,
      ) as (typeof commandFixtures)[number];
      expect(validateCommand({ ...fixture, payload: { extra: 1 } })).toBe(
        false,
      );
    }
  });

  it('accepts LOBBY-phase RoomView projections with populated availableActions', () => {
    const hostView = lobbyRoomView(true);
    expect(
      validateRoomView(hostView),
      JSON.stringify(validateRoomView.errors),
    ).toBe(true);
    expect(
      hostView.private.availableActions.map((action) => action.commandType),
    ).toEqual([
      'ConfigureRoom',
      'ReorderSeats',
      'SetReady',
      'KickLobbyPlayer',
      'CloseRoom',
    ]);

    const guestView = lobbyRoomView(false);
    expect(
      validateRoomView(guestView),
      JSON.stringify(validateRoomView.errors),
    ).toBe(true);
    expect(
      guestView.private.availableActions.map((action) => action.commandType),
    ).toEqual(['SetReady', 'LeaveLobby']);
  });

  it('accepts assassination targets only in the private action projection', () => {
    const view = roomViewForRole('ASSASSIN');
    view.public.phase = 'ASSASSINATION';
    view.public.phaseStage = 'COLLECTING';
    view.public.successCount = 3;
    view.public.revealedAssignments = [];
    view.private.availableActions = [
      {
        commandType: 'SelectMerlinTarget',
        eligibleTargetPlayerIds: UUIDS.players.slice(1),
      },
    ];
    expect(
      validateRoomView(view),
      JSON.stringify(validateRoomView.errors),
    ).toBe(true);
    expect(JSON.stringify(view.public)).not.toContain(
      'eligibleTargetPlayerIds',
    );
  });

  it('accepts pause termination counts while rejecting public individual choices', () => {
    const view = roomViewForRole('LOYAL_SERVANT');
    view.public.phase = 'PAUSED';
    view.public.pauseReasons = ['PLAYER_DISCONNECTED'];
    view.public.recoveryStartedAt = '2026-08-13T10:00:00.000Z';
    view.public.recoveryExpiresAt = '2026-08-13T11:00:00.000Z';
    view.public.pauseTerminationVoteAvailableAt = '2026-08-13T10:01:00.000Z';
    view.public.pauseTerminationVote = {
      startedAt: '2026-08-13T10:01:00.000Z',
      expiresAt: '2026-08-13T10:01:30.000Z',
      eligibleCount: 4,
      submittedCount: 1,
    };
    view.private.pauseTerminationVoteStatus = 'PENDING';
    view.private.availableActions = [
      {
        commandType: 'SubmitPauseTerminationVote',
        allowedPauseTerminationChoices: ['TERMINATE', 'CONTINUE_PAUSE'],
      },
    ];
    expect(
      validateRoomView(view),
      JSON.stringify(validateRoomView.errors),
    ).toBe(true);
    expect(
      validateRoomView({
        ...view,
        public: {
          ...view.public,
          pauseTerminationVote: {
            ...view.public.pauseTerminationVote,
            choices: { [UUIDS.players[0]]: 'TERMINATE' },
          },
        },
      }),
    ).toBe(false);
  });

  it('accepts terminal role revelation without task-action attribution', () => {
    const view = roomViewForRole('MERLIN');
    view.public.phase = 'GAME_OVER';
    view.public.phaseStage = 'RESOLVED';
    view.public.successCount = 3;
    view.public.gameOutcome = {
      winner: 'EVIL',
      reason: 'MERLIN_ASSASSINATED',
      assassinationTargetPlayerId: UUIDS.players[0],
    };
    const terminalRoles = [
      'MERLIN',
      'LOYAL_SERVANT',
      'LOYAL_SERVANT',
      'ASSASSIN',
      'MINION',
    ] as const;
    view.public.revealedAssignments = UUIDS.players.map((playerId, index) => ({
      playerId,
      roleId: terminalRoles[index] ?? 'LOYAL_SERVANT',
      alignment: index < 3 ? ('GOOD' as const) : ('EVIL' as const),
    }));
    view.private.availableActions = [];
    expect(
      validateRoomView(view),
      JSON.stringify(validateRoomView.errors),
    ).toBe(true);
    expect(JSON.stringify(view)).not.toContain('questChoices');
  });
});

describe('TEST-contract / NFR-014 projection boundaries', () => {
  const roles: readonly RoleId[] = [
    'MERLIN',
    'LOYAL_SERVANT',
    'PERCIVAL',
    'ASSASSIN',
    'MINION',
    'MORGANA',
    'MORDRED',
    'OBERON',
  ];

  it.each(roles)('accepts the allowlisted %s player projection', (role) => {
    const roomView = roomViewForRole(role);
    expect(
      validateRoomView(roomView),
      JSON.stringify(validateRoomView.errors),
    ).toBe(true);
    expect(Object.keys(roomView.private).sort()).toEqual(
      [
        'availableActions',
        'hasSubmitted',
        'knownPlayers',
        'playerId',
        'selfAlignment',
        'selfRole',
        'sessionExpiresAt',
        'shouldPlayAudio',
      ].sort(),
    );
  });

  it('requires server-authoritative team-vote totals on revealed proposals', () => {
    const roomView = roomViewForRole('MERLIN');
    roomView.public.phase = 'TEAM_VOTE';
    roomView.public.phaseStage = 'RESOLVED';
    roomView.public.proposedTeamPlayerIds = UUIDS.players.slice(0, 2);
    roomView.public.proposalHistory = [
      {
        questIndex: 1,
        proposalAttempt: 1,
        leaderPlayerId: UUIDS.players[0],
        teamPlayerIds: UUIDS.players.slice(0, 2),
        votes: UUIDS.players.map((playerId, index) => ({
          playerId,
          vote: index < 3 ? 'APPROVE' : 'REJECT',
        })),
        approveCount: 3,
        rejectCount: 2,
        approved: true,
      },
    ];
    expect(
      validateRoomView(roomView),
      JSON.stringify(validateRoomView.errors),
    ).toBe(true);

    const withoutTotals = structuredClone(roomView) as unknown as {
      public: { proposalHistory: Array<Record<string, unknown>> };
    };
    delete withoutTotals.public.proposalHistory[0]?.approveCount;
    expect(validateRoomView(withoutTotals)).toBe(false);
  });

  it.each([
    'roleAssignments',
    'privateKnowledge',
    'questChoices',
    'teamVotes',
    'sessionToken',
  ])('rejects forbidden RoomView field %s', (field) => {
    const roomView = roomViewForRole('MERLIN') as unknown as Record<
      string,
      unknown
    >;
    roomView[field] = 'forbidden';
    expect(validateRoomView(roomView)).toBe(false);
  });

  it('enforces shouldPlayAudio=false for RESYNC', () => {
    const roomView = roomViewForRole('MERLIN');
    expect(
      validateSessionReady({
        protocolVersion: 2,
        delivery: 'RESYNC',
        roomView,
      }),
      JSON.stringify(validateSessionReady.errors),
    ).toBe(true);

    roomView.private.shouldPlayAudio = true;
    expect(
      validateSessionReady({
        protocolVersion: 2,
        delivery: 'RESYNC',
        roomView,
      }),
    ).toBe(false);
  });
});

describe('TEST-contract / HTTP and configuration schemas', () => {
  it('accepts valid create/bootstrap payloads', () => {
    expect(
      validateCreateRoom({
        nickname: '玩家一号',
        config: presetConfig,
        client: clientCapabilities,
      }),
      JSON.stringify(validateCreateRoom.errors),
    ).toBe(true);
    expect(
      validateSessionBootstrap({
        protocolVersion: 2,
        roomCode: '7K3M9Q',
        playerId: UUIDS.players[0],
        sessionToken: testSessionToken,
        sessionExpiresAt: '2026-08-13T12:00:00.000Z',
        realtimeUrl: 'wss://avalon.example/game-v2',
        roomView: roomViewForRole('MERLIN'),
      }),
      JSON.stringify(validateSessionBootstrap.errors),
    ).toBe(true);
  });

  it('rejects invalid input bounds, transport, and unknown fields', () => {
    expect(
      validateCreateRoom({
        nickname: '',
        config: presetConfig,
        client: clientCapabilities,
      }),
    ).toBe(false);
    expect(
      validateCreateRoom({
        nickname: '玩家一号',
        config: { ...presetConfig, playerCount: 11 },
        client: { ...clientCapabilities, platform: 'WEB' },
      }),
    ).toBe(false);
    expect(
      validateSessionBootstrap({
        protocolVersion: 2,
        roomCode: '7K3M9Q',
        playerId: UUIDS.players[0],
        sessionToken: testSessionToken,
        sessionExpiresAt: '2026-08-13T12:00:00.000Z',
        realtimeUrl: 'ws://insecure.example/game-v2',
        roomView: roomViewForRole('MERLIN'),
      }),
    ).toBe(false);
    expect(validateRoomConfig({ ...presetConfig, extra: true })).toBe(false);
    expect(
      validateRoomConfig({
        ...presetConfig,
        roleSelection: { type: 'PRESET', presetId: 'RECOMMENDED' },
      }),
    ).toBe(true);
    expect(
      validateRoomConfig({
        ...presetConfig,
        roleSelection: { type: 'PRESET', presetId: 'COMMON_ROLES' },
      }),
    ).toBe(false);
  });

  it('accepts the WeChat Mini Program client platform', () => {
    expect(
      validateCreateRoom({
        nickname: 'Arthur',
        config: presetConfig,
        client: {
          ...clientCapabilities,
          platform: 'WECHAT_MINIPROGRAM',
        },
      }),
    ).toBe(true);
  });
});

describe('TEST-contract / stable error and realtime messages', () => {
  it('accepts allowlisted error and realtime variants', () => {
    expect(
      validateError({
        error: {
          code: 'STALE_VERSION',
          diagnosticId: 'diag-m0-0001',
          retryable: true,
          currentStateVersion: 4,
        },
      }),
      JSON.stringify(validateError.errors),
    ).toBe(true);
    expect(
      validateRealtimeAuth({
        protocolVersion: 2,
        sessionToken: testSessionToken,
        lastStateVersion: 3,
      }),
      JSON.stringify(validateRealtimeAuth.errors),
    ).toBe(true);
    expect(
      validateRoomViewMessage({
        protocolVersion: 2,
        delivery: 'LIVE',
        eventId: UUIDS.event,
        roomView: roomViewForRole('MERLIN'),
      }),
      JSON.stringify(validateRoomViewMessage.errors),
    ).toBe(true);
    expect(
      validateCommandResult({
        commandId: UUIDS.command,
        accepted: true,
        stateVersion: 4,
      }),
      JSON.stringify(validateCommandResult.errors),
    ).toBe(true);
  });

  it('rejects unstable error values, token fields, and invalid resync audio', () => {
    expect(
      validateError({
        error: {
          code: 'DATABASE_ERROR',
          diagnosticId: 'diag-m0-0001',
          retryable: false,
        },
      }),
    ).toBe(false);
    expect(
      validateRealtimeAuth({
        protocolVersion: 2,
        sessionToken: 'short',
        lastStateVersion: -1,
      }),
    ).toBe(false);

    const roomView = roomViewForRole('MERLIN');
    roomView.private.shouldPlayAudio = true;
    expect(
      validateRoomViewMessage({
        protocolVersion: 2,
        delivery: 'RESYNC',
        eventId: UUIDS.event,
        roomView,
      }),
    ).toBe(false);
  });
});

describe('TEST-contract / token schema placement', () => {
  it('places sessionToken only in bootstrap and realtime auth messages', () => {
    const occurrences: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          walk(item, `${path}[${String(index)}]`);
        });
        return;
      }
      if (typeof value !== 'object' || value === null) return;
      for (const [key, nested] of Object.entries(value)) {
        const nextPath = `${path}.${key}`;
        if (key === 'sessionToken') occurrences.push(nextPath);
        walk(nested, nextPath);
      }
    };

    walk(HttpSchemaDocument, 'http');
    walk(TransportSchemaDocument, 'transport');
    expect(occurrences).toEqual([
      'http.$defs.SessionBootstrap.properties.sessionToken',
      'transport.$defs.RealtimeAuth.properties.sessionToken',
    ]);
  });
});

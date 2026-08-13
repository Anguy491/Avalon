import { describe, expect, it } from 'vitest';

import {
  commandFixtures,
  roomViewForRole,
  UUIDS,
} from './contract-fixtures.js';
import {
  CommandSchemaDocument,
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
  protocolVersion: 1,
  platform: 'IOS',
  appVersion: '0.1.0',
  voicePackVersions: ['zh-CN-v1'],
} as const;

const presetConfig = {
  rulesVersion: 'CLASSIC_AVALON_V1',
  playerCount: 5,
  roleSelection: { type: 'PRESET', presetId: 'CLASSIC' },
  locale: 'zh-CN',
} as const;

const testSessionToken = 'M0_test_session_token_01';

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
        protocolVersion: 1,
        delivery: 'RESYNC',
        roomView,
      }),
      JSON.stringify(validateSessionReady.errors),
    ).toBe(true);

    roomView.private.shouldPlayAudio = true;
    expect(
      validateSessionReady({
        protocolVersion: 1,
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
        protocolVersion: 1,
        roomCode: '7K3M9Q',
        playerId: UUIDS.players[0],
        sessionToken: testSessionToken,
        sessionExpiresAt: '2026-08-13T12:00:00.000Z',
        realtimeUrl: 'wss://avalon.example/game-v1',
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
        protocolVersion: 1,
        roomCode: '7K3M9Q',
        playerId: UUIDS.players[0],
        sessionToken: testSessionToken,
        sessionExpiresAt: '2026-08-13T12:00:00.000Z',
        realtimeUrl: 'ws://insecure.example/game-v1',
        roomView: roomViewForRole('MERLIN'),
      }),
    ).toBe(false);
    expect(validateRoomConfig({ ...presetConfig, extra: true })).toBe(false);
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
        protocolVersion: 1,
        sessionToken: testSessionToken,
        lastStateVersion: 3,
      }),
      JSON.stringify(validateRealtimeAuth.errors),
    ).toBe(true);
    expect(
      validateRoomViewMessage({
        protocolVersion: 1,
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
        protocolVersion: 1,
        sessionToken: 'short',
        lastStateVersion: -1,
      }),
    ).toBe(false);

    const roomView = roomViewForRole('MERLIN');
    roomView.private.shouldPlayAudio = true;
    expect(
      validateRoomViewMessage({
        protocolVersion: 1,
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

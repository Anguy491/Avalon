import { resolve } from 'node:path';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { runner } from 'node-pg-migrate';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Command, CreateRoomRequest } from '@avalon/protocol';
import type { GameState } from '@avalon/game-engine';

import { CommandService } from './command-service.js';
import type { ServerConfig } from './config.js';
import {
  OutboxWorker,
  type ProjectionDelivery,
  type ProjectionPublisher,
} from './outbox-worker.js';
import { RoomService } from './room-service.js';
import type { RuntimePorts } from './runtime-ports.js';

const migrationsDirectory = resolve(import.meta.dirname, '../migrations');
const id = (value: number): string =>
  `60000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

interface TestPorts {
  readonly ports: RuntimePorts;
  advance(milliseconds: number): void;
}

function createTestPorts(): TestPorts {
  let identifier = 0;
  let randomValue = 0;
  let now = new Date('2026-08-13T10:00:00.000Z');
  return {
    ports: {
      clock: { now: () => new Date(now) },
      ids: {
        next: () => {
          identifier += 1;
          return id(identifier);
        },
      },
      random: {
        bytes: (length) =>
          Uint8Array.from({ length }, () => {
            randomValue = (randomValue + 17) & 255;
            return randomValue;
          }),
      },
    },
    advance(milliseconds) {
      now = new Date(now.getTime() + milliseconds);
    },
  };
}

function createRequest(
  nickname = 'Arthur',
  playerCount = 5,
): CreateRoomRequest {
  return {
    nickname,
    config: {
      rulesVersion: 'CLASSIC_AVALON_V1',
      playerCount,
      roleSelection: { type: 'PRESET', presetId: 'CLASSIC' },
      locale: 'zh-CN',
    },
    client: {
      protocolVersion: 1,
      platform: 'IOS',
      appVersion: '0.1.0',
      installationId: id(900),
      voicePackVersions: ['zh-CN-v1'],
    },
  };
}

function joinRequest(nickname: string) {
  return {
    nickname,
    client: {
      protocolVersion: 1 as const,
      platform: 'ANDROID' as const,
      appVersion: '0.1.0',
      installationId: id(901),
      voicePackVersions: ['zh-CN-v1'],
    },
  };
}

class MemoryPublisher implements ProjectionPublisher {
  readonly deliveries: ProjectionDelivery[] = [];

  publish(delivery: ProjectionDelivery): Promise<void> {
    this.deliveries.push(delivery);
    return Promise.resolve();
  }
}

interface RosterMember {
  readonly playerId: string;
  readonly sessionToken: string;
}

interface Roster {
  readonly roomId: string;
  readonly roomCode: string;
  readonly stateVersion: number;
  readonly members: readonly RosterMember[];
}

function member(roster: Roster, index: number): RosterMember {
  const found = roster.members[index];
  if (found === undefined) {
    throw new Error(`Missing roster member at index ${String(index)}`);
  }
  return found;
}

const NICKNAMES = [
  'Gawain',
  'Lancelot',
  'Galahad',
  'Kay',
  'Bedivere',
  'Tristan',
  'Gareth',
  'Percival',
  'Bors',
] as const;

async function prepareLobbyRoster(
  service: RoomService,
  playerCount: number,
  commandIdBase: number,
): Promise<Roster> {
  const created = await service.createRoom(
    id(commandIdBase),
    createRequest('HostArthur', playerCount),
  );
  const members: RosterMember[] = [
    {
      playerId: created.body.playerId,
      sessionToken: created.body.sessionToken,
    },
  ];
  for (let index = 0; index < playerCount - 1; index += 1) {
    const nickname = NICKNAMES[index];
    if (nickname === undefined) throw new Error('Not enough nicknames');
    const joined = await service.joinRoom(
      id(commandIdBase + index + 1),
      created.body.roomCode,
      joinRequest(nickname),
    );
    members.push({
      playerId: joined.body.playerId,
      sessionToken: joined.body.sessionToken,
    });
  }
  return {
    roomId: created.body.roomView.public.roomId,
    roomCode: created.body.roomCode,
    stateVersion: playerCount - 1,
    members,
  };
}

function lobbyCommand(
  commandId: string,
  roomId: string,
  expectedStateVersion: number,
  body:
    | {
        readonly type: 'SetReady';
        readonly payload: { readonly ready: boolean };
      }
    | {
        readonly type: 'ConfigureRoom';
        readonly payload: { readonly config: CreateRoomRequest['config'] };
      }
    | {
        readonly type: 'ReorderSeats';
        readonly payload: { readonly playerIds: readonly string[] };
      }
    | { readonly type: 'LeaveLobby'; readonly payload: Record<string, never> }
    | {
        readonly type: 'KickLobbyPlayer';
        readonly payload: { readonly targetPlayerId: string };
      }
    | { readonly type: 'CloseRoom'; readonly payload: Record<string, never> },
): Command {
  return {
    commandId,
    roomId,
    expectedStateVersion,
    sentAt: '2026-08-13T10:00:00.000Z',
    ...body,
  } as Command;
}

describe('M3-001–M3-002 lobby command persistence, revocation, idempotency, and concurrency', () => {
  let databaseUrl: string;
  let redisUrl: string;
  let sql: postgres.Sql;
  let stopContainers: () => Promise<void>;
  let config: ServerConfig;

  beforeAll(async () => {
    const [postgresContainer, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:18.1-alpine3.22').start(),
      new RedisContainer('redis:8.2.3-alpine3.22').start(),
    ]);
    databaseUrl = postgresContainer.getConnectionUri();
    redisUrl = redisContainer.getConnectionUrl();
    stopContainers = async () => {
      await Promise.all([postgresContainer.stop(), redisContainer.stop()]);
    };
    await runner({
      databaseUrl,
      dir: migrationsDirectory,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      log: () => undefined,
    });
    sql = postgres(databaseUrl, { max: 10, onnotice: () => undefined });
    config = {
      nodeEnv: 'test',
      host: '127.0.0.1',
      port: 0,
      logLevel: 'silent',
      databaseUrl,
      redisUrl,
      rateLimitMax: 100,
      rateLimitHmacSecret: 'integration-rate-limit-material-000002',
      joinRateLimitMax: 20,
      sessionTokenPepper: 'integration-session-pepper-material-0002',
      idempotencyEncryptionSecret: 'integration-idempotency-encryption-0002',
      sessionTtlSeconds: 1_800,
      realtimePublicUrl: 'wss://localhost.invalid/game-v1',
    };
  }, 120_000);

  beforeEach(async () => {
    const [exists] = await sql<{ readonly exists: boolean }[]>`
      select to_regclass('avalon_runtime.rooms') is not null as exists
    `;
    if (exists?.exists === true) {
      await sql`truncate table avalon_runtime.rooms cascade`;
    }
  });

  afterAll(async () => {
    await sql.end({ timeout: 2 });
    await stopContainers();
  });

  it('SM-006 lets each player set only their own readiness, and concurrent SetReady from two players loses no update', async () => {
    const testPorts = createTestPorts();
    const roomService = new RoomService(sql, config, testPorts.ports);
    const commands = new CommandService(sql, config, testPorts.ports);
    const roster = await prepareLobbyRoster(roomService, 6, 10);
    const contexts = await Promise.all(
      roster.members.map((member) =>
        roomService.authenticate(member.sessionToken),
      ),
    );

    const [player0, player1] = contexts;
    if (player0 === undefined || player1 === undefined) {
      throw new Error('Expected at least two players');
    }
    const [result0, result1] = await Promise.all([
      commands.submit(
        player0,
        lobbyCommand(id(200), roster.roomId, roster.stateVersion, {
          type: 'SetReady',
          payload: { ready: true },
        }),
      ),
      commands.submit(
        player1,
        lobbyCommand(id(201), roster.roomId, roster.stateVersion, {
          type: 'SetReady',
          payload: { ready: true },
        }),
      ),
    ]);
    // Both submissions raced on the same expectedStateVersion: exactly one
    // observes the pre-mutation version and succeeds, the other must retry.
    const accepted = [result0, result1].filter((result) => result.accepted);
    const staleRejections = [result0, result1].filter(
      (result) => !result.accepted && result.error.code === 'STALE_VERSION',
    );
    expect(accepted).toHaveLength(1);
    expect(staleRejections).toHaveLength(1);

    const [row] = await sql<{ readonly aggregate: unknown }[]>`
      select aggregate from avalon_runtime.rooms where room_id = ${roster.roomId}
    `;
    const stateAfterFirst =
      typeof row?.aggregate === 'string'
        ? (JSON.parse(row.aggregate) as GameState)
        : (row?.aggregate as GameState);

    // Retry the loser with the now-current version; no update should be lost.
    const loserContext = result0.accepted ? player1 : player0;
    const retryCommandId = result0.accepted ? id(202) : id(203);
    const retry = await commands.submit(
      loserContext,
      lobbyCommand(
        retryCommandId,
        roster.roomId,
        stateAfterFirst.stateVersion,
        { type: 'SetReady', payload: { ready: true } },
      ),
    );
    expect(retry.accepted).toBe(true);

    const [finalRow] = await sql<{ readonly aggregate: unknown }[]>`
      select aggregate from avalon_runtime.rooms where room_id = ${roster.roomId}
    `;
    const finalState =
      typeof finalRow?.aggregate === 'string'
        ? (JSON.parse(finalRow.aggregate) as GameState)
        : (finalRow?.aggregate as GameState);
    expect(
      finalState.players.find((p) => p.playerId === player0.playerId)?.ready,
    ).toBe(true);
    expect(
      finalState.players.find((p) => p.playerId === player1.playerId)?.ready,
    ).toBe(true);
    // Nobody else was toggled.
    expect(
      finalState.players
        .filter((p) => p.ready)
        .map((p) => p.playerId)
        .sort(),
    ).toEqual([player0.playerId, player1.playerId].sort());
  });

  it('SM-004 ConfigureRoom resets readiness for every player and rejects illegal actors/configs', async () => {
    const testPorts = createTestPorts();
    const roomService = new RoomService(sql, config, testPorts.ports);
    const commands = new CommandService(sql, config, testPorts.ports);
    const roster = await prepareLobbyRoster(roomService, 6, 20);
    const host = await roomService.authenticate(member(roster, 0).sessionToken);
    const guest = await roomService.authenticate(
      member(roster, 1).sessionToken,
    );

    await commands.submit(
      host,
      lobbyCommand(id(220), roster.roomId, roster.stateVersion, {
        type: 'SetReady',
        payload: { ready: true },
      }),
    );

    const nonHost = await commands.submit(
      guest,
      lobbyCommand(id(221), roster.roomId, roster.stateVersion + 1, {
        type: 'ConfigureRoom',
        payload: {
          config: {
            rulesVersion: 'CLASSIC_AVALON_V1',
            playerCount: 6,
            roleSelection: { type: 'PRESET', presetId: 'COMMON_ROLES' },
            locale: 'zh-CN',
          },
        },
      }),
    );
    expect(nonHost).toMatchObject({
      accepted: false,
      error: { code: 'NOT_HOST' },
    });

    const shrink = await commands.submit(
      host,
      lobbyCommand(id(222), roster.roomId, roster.stateVersion + 1, {
        type: 'ConfigureRoom',
        payload: {
          config: {
            rulesVersion: 'CLASSIC_AVALON_V1',
            playerCount: 5,
            roleSelection: { type: 'PRESET', presetId: 'CLASSIC' },
            locale: 'zh-CN',
          },
        },
      }),
    );
    expect(shrink).toMatchObject({
      accepted: false,
      error: { code: 'INVALID_CONFIG' },
    });

    const reconfigured = await commands.submit(
      host,
      lobbyCommand(id(223), roster.roomId, roster.stateVersion + 1, {
        type: 'ConfigureRoom',
        payload: {
          config: {
            rulesVersion: 'CLASSIC_AVALON_V1',
            playerCount: 6,
            roleSelection: { type: 'PRESET', presetId: 'COMMON_ROLES' },
            locale: 'zh-CN',
          },
        },
      }),
    );
    expect(reconfigured.accepted).toBe(true);

    const [row] = await sql<{ readonly aggregate: unknown }[]>`
      select aggregate from avalon_runtime.rooms where room_id = ${roster.roomId}
    `;
    const state =
      typeof row?.aggregate === 'string'
        ? (JSON.parse(row.aggregate) as GameState)
        : (row?.aggregate as GameState);
    expect(state.config.roleIds).toContain('PERCIVAL');
    expect(state.players.every((p) => !p.ready)).toBe(true);
  });

  it('SM-005 ReorderSeats resets readiness, rejects illegal permutations, and serializes concurrent reorders', async () => {
    const testPorts = createTestPorts();
    const roomService = new RoomService(sql, config, testPorts.ports);
    const commands = new CommandService(sql, config, testPorts.ports);
    const roster = await prepareLobbyRoster(roomService, 5, 30);
    const host = await roomService.authenticate(member(roster, 0).sessionToken);
    const ids = roster.members.map((member) => member.playerId);

    const invalid = await commands.submit(
      host,
      lobbyCommand(id(240), roster.roomId, roster.stateVersion, {
        type: 'ReorderSeats',
        payload: { playerIds: ids.slice(0, 3) },
      }),
    );
    expect(invalid).toMatchObject({
      accepted: false,
      error: { code: 'INVALID_SEAT_ORDER' },
    });

    const reversed = [...ids].reverse();
    const firstId = ids[0];
    if (firstId === undefined) throw new Error('Missing first player id');
    const rotated = [...ids.slice(1), firstId];
    const [first, second] = await Promise.all([
      commands.submit(
        host,
        lobbyCommand(id(241), roster.roomId, roster.stateVersion, {
          type: 'ReorderSeats',
          payload: { playerIds: reversed },
        }),
      ),
      commands.submit(
        host,
        lobbyCommand(id(242), roster.roomId, roster.stateVersion, {
          type: 'ReorderSeats',
          payload: { playerIds: rotated },
        }),
      ),
    ]);
    const acceptedReorders = [first, second].filter(
      (result) => result.accepted,
    );
    const staleReorders = [first, second].filter(
      (result) => !result.accepted && result.error.code === 'STALE_VERSION',
    );
    expect(acceptedReorders).toHaveLength(1);
    expect(staleReorders).toHaveLength(1);

    const [row] = await sql<{ readonly aggregate: unknown }[]>`
      select aggregate from avalon_runtime.rooms where room_id = ${roster.roomId}
    `;
    const state =
      typeof row?.aggregate === 'string'
        ? (JSON.parse(row.aggregate) as GameState)
        : (row?.aggregate as GameState);
    expect(state.players.every((p) => !p.ready)).toBe(true);
    const seats = state.players.map((p) => p.seat).sort((a, b) => a - b);
    seats.forEach((seat, index) => {
      expect(seat).toBe(index);
    });
  });

  it('SM-017 LeaveLobby compresses seats, resets readiness, revokes the leaving session, and forbids the host', async () => {
    const testPorts = createTestPorts();
    const roomService = new RoomService(sql, config, testPorts.ports);
    const commands = new CommandService(sql, config, testPorts.ports);
    const roster = await prepareLobbyRoster(roomService, 6, 50);
    const host = await roomService.authenticate(member(roster, 0).sessionToken);
    const leaver = await roomService.authenticate(
      member(roster, 2).sessionToken,
    );

    const hostLeave = await commands.submit(
      host,
      lobbyCommand(id(260), roster.roomId, roster.stateVersion, {
        type: 'LeaveLobby',
        payload: {},
      }),
    );
    expect(hostLeave).toMatchObject({
      accepted: false,
      error: { code: 'HOST_CANNOT_LEAVE' },
    });

    const left = await commands.submit(
      leaver,
      lobbyCommand(id(261), roster.roomId, roster.stateVersion, {
        type: 'LeaveLobby',
        payload: {},
      }),
    );
    expect(left.accepted).toBe(true);

    const [session] = await sql<{ readonly revoked_at: Date | null }[]>`
      select revoked_at from avalon_runtime.sessions
       where session_id = ${leaver.sessionId}
    `;
    expect(session?.revoked_at).not.toBeNull();

    const retryAfterRevocation = await commands.submit(
      leaver,
      lobbyCommand(id(262), roster.roomId, roster.stateVersion + 1, {
        type: 'SetReady',
        payload: { ready: true },
      }),
    );
    expect(retryAfterRevocation).toMatchObject({
      accepted: false,
      error: { code: 'SESSION_INVALID' },
    });

    const [row] = await sql<{ readonly aggregate: unknown }[]>`
      select aggregate from avalon_runtime.rooms where room_id = ${roster.roomId}
    `;
    const state =
      typeof row?.aggregate === 'string'
        ? (JSON.parse(row.aggregate) as GameState)
        : (row?.aggregate as GameState);
    expect(state.players).toHaveLength(5);
    expect(state.players.some((p) => p.playerId === leaver.playerId)).toBe(
      false,
    );
    expect(state.players.every((p) => !p.ready)).toBe(true);
    const seats = state.players.map((p) => p.seat).sort((a, b) => a - b);
    seats.forEach((seat, index) => {
      expect(seat).toBe(index);
    });
  });

  it('SM-018 KickLobbyPlayer revokes the target session and rejects illegal actors/targets', async () => {
    const testPorts = createTestPorts();
    const roomService = new RoomService(sql, config, testPorts.ports);
    const commands = new CommandService(sql, config, testPorts.ports);
    const roster = await prepareLobbyRoster(roomService, 6, 70);
    const host = await roomService.authenticate(member(roster, 0).sessionToken);
    const guest = await roomService.authenticate(
      member(roster, 1).sessionToken,
    );
    const target = await roomService.authenticate(
      member(roster, 3).sessionToken,
    );

    const nonHostKick = await commands.submit(
      guest,
      lobbyCommand(id(280), roster.roomId, roster.stateVersion, {
        type: 'KickLobbyPlayer',
        payload: { targetPlayerId: target.playerId },
      }),
    );
    expect(nonHostKick).toMatchObject({
      accepted: false,
      error: { code: 'NOT_HOST' },
    });

    const kickHost = await commands.submit(
      host,
      lobbyCommand(id(281), roster.roomId, roster.stateVersion, {
        type: 'KickLobbyPlayer',
        payload: { targetPlayerId: host.playerId },
      }),
    );
    expect(kickHost).toMatchObject({
      accepted: false,
      error: { code: 'INVALID_TARGET' },
    });

    const crossRoomTarget = await commands.submit(
      host,
      lobbyCommand(id(282), roster.roomId, roster.stateVersion, {
        type: 'KickLobbyPlayer',
        payload: { targetPlayerId: id(999_999) },
      }),
    );
    expect(crossRoomTarget).toMatchObject({
      accepted: false,
      error: { code: 'INVALID_TARGET' },
    });

    const kicked = await commands.submit(
      host,
      lobbyCommand(id(283), roster.roomId, roster.stateVersion, {
        type: 'KickLobbyPlayer',
        payload: { targetPlayerId: target.playerId },
      }),
    );
    expect(kicked.accepted).toBe(true);

    const [session] = await sql<{ readonly revoked_at: Date | null }[]>`
      select revoked_at from avalon_runtime.sessions
       where session_id = ${target.sessionId}
    `;
    expect(session?.revoked_at).not.toBeNull();

    const retryAfterKick = await commands.submit(
      target,
      lobbyCommand(id(284), roster.roomId, roster.stateVersion + 1, {
        type: 'SetReady',
        payload: { ready: true },
      }),
    );
    expect(retryAfterKick).toMatchObject({
      accepted: false,
      error: { code: 'SESSION_INVALID' },
    });
  });

  it('SM-019 CloseRoom deletes the room and cascades sessions/players/processed-commands/outbox atomically', async () => {
    const testPorts = createTestPorts();
    const roomService = new RoomService(sql, config, testPorts.ports);
    const commands = new CommandService(sql, config, testPorts.ports);
    const roster = await prepareLobbyRoster(roomService, 5, 90);
    const host = await roomService.authenticate(member(roster, 0).sessionToken);
    const guest = await roomService.authenticate(
      member(roster, 1).sessionToken,
    );

    const nonHostClose = await commands.submit(
      guest,
      lobbyCommand(id(300), roster.roomId, roster.stateVersion, {
        type: 'CloseRoom',
        payload: {},
      }),
    );
    expect(nonHostClose).toMatchObject({
      accepted: false,
      error: { code: 'NOT_HOST' },
    });

    const closed = await commands.submit(
      host,
      lobbyCommand(id(301), roster.roomId, roster.stateVersion, {
        type: 'CloseRoom',
        payload: {},
      }),
    );
    expect(closed.accepted).toBe(true);

    const [counts] = await sql<
      {
        readonly rooms: number;
        readonly players: number;
        readonly sessions: number;
        readonly commands: number;
        readonly outbox: number;
      }[]
    >`
      select
        (select count(*)::integer from avalon_runtime.rooms
          where room_id = ${roster.roomId}) as rooms,
        (select count(*)::integer from avalon_runtime.players
          where room_id = ${roster.roomId}) as players,
        (select count(*)::integer from avalon_runtime.sessions
          where room_id = ${roster.roomId}) as sessions,
        (select count(*)::integer from avalon_runtime.processed_commands
          where room_id = ${roster.roomId}) as commands,
        (select count(*)::integer from avalon_runtime.outbox
          where room_id = ${roster.roomId}) as outbox
    `;
    expect(counts).toEqual({
      rooms: 0,
      players: 0,
      sessions: 0,
      commands: 0,
      outbox: 0,
    });

    const anyoneAfterClose = await commands.submit(
      guest,
      lobbyCommand(id(302), roster.roomId, roster.stateVersion + 1, {
        type: 'SetReady',
        payload: { ready: true },
      }),
    );
    expect(anyoneAfterClose).toMatchObject({
      accepted: false,
      error: { code: 'SESSION_INVALID' },
    });
  });

  it('serializes two concurrent CloseRoom submissions from the host to exactly one success', async () => {
    const testPorts = createTestPorts();
    const roomService = new RoomService(sql, config, testPorts.ports);
    const commands = new CommandService(sql, config, testPorts.ports);
    const roster = await prepareLobbyRoster(roomService, 5, 110);
    const host = await roomService.authenticate(member(roster, 0).sessionToken);

    const [first, second] = await Promise.all([
      commands.submit(
        host,
        lobbyCommand(id(320), roster.roomId, roster.stateVersion, {
          type: 'CloseRoom',
          payload: {},
        }),
      ),
      commands.submit(
        host,
        lobbyCommand(id(321), roster.roomId, roster.stateVersion, {
          type: 'CloseRoom',
          payload: {},
        }),
      ),
    ]);
    const accepted = [first, second].filter((result) => result.accepted);
    const rejected = [first, second].filter((result) => !result.accepted);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The loser observes its own session vanish (cascaded by the winner's
    // room deletion) rather than a generic internal error.
    expect(rejected[0]).toMatchObject({
      error: { code: 'SESSION_INVALID' },
    });
  });

  it('idempotency: replays an identical retried commandId and rejects a conflicting payload for the same commandId', async () => {
    const testPorts = createTestPorts();
    const roomService = new RoomService(sql, config, testPorts.ports);
    const commands = new CommandService(sql, config, testPorts.ports);
    const roster = await prepareLobbyRoster(roomService, 5, 130);
    const host = await roomService.authenticate(member(roster, 0).sessionToken);

    const command = lobbyCommand(id(340), roster.roomId, roster.stateVersion, {
      type: 'SetReady',
      payload: { ready: true },
    });
    const first = await commands.submit(host, command);
    const replay = await commands.submit(host, command);
    expect(replay).toEqual(first);

    const conflicting = await commands.submit(host, {
      ...command,
      type: 'SetReady',
      payload: { ready: false },
    });
    expect(conflicting).toMatchObject({
      accepted: false,
      error: { code: 'DUPLICATE_COMMAND_CONFLICT' },
    });
  });

  it('publishes personalized, session-scoped LIVE projections to every remaining player and never to a revoked session', async () => {
    const testPorts = createTestPorts();
    const roomService = new RoomService(sql, config, testPorts.ports);
    const commands = new CommandService(sql, config, testPorts.ports);
    const roster = await prepareLobbyRoster(roomService, 6, 150);
    const host = await roomService.authenticate(member(roster, 0).sessionToken);
    const leaver = await roomService.authenticate(
      member(roster, 2).sessionToken,
    );

    const left = await commands.submit(
      leaver,
      lobbyCommand(id(360), roster.roomId, roster.stateVersion, {
        type: 'LeaveLobby',
        payload: {},
      }),
    );
    expect(left.accepted).toBe(true);

    const publisher = new MemoryPublisher();
    const worker = new OutboxWorker(sql, publisher, testPorts.ports, {
      workerId: id(361),
      batchSize: 100,
    });
    await worker.drainOnce();

    const remainingPlayerIds = roster.members
      .filter((member) => member.playerId !== leaver.playerId)
      .map((member) => member.playerId);
    const deliveredPlayerIds = publisher.deliveries.map(
      (delivery) => delivery.playerId,
    );
    expect(new Set(deliveredPlayerIds)).toEqual(new Set(remainingPlayerIds));
    expect(deliveredPlayerIds).not.toContain(leaver.playerId);

    for (const delivery of publisher.deliveries) {
      expect(delivery.message.roomView.private.playerId).toBe(
        delivery.playerId,
      );
      expect(delivery.message.roomView.public.players).toHaveLength(5);
    }
    expect(host.playerId).not.toBe(leaver.playerId);
  });
});

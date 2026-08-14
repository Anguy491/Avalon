import { resolve } from 'node:path';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { io as createSocketClient, type Socket } from 'socket.io-client';
import { runner } from 'node-pg-migrate';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Command, CreateRoomRequest } from '@avalon/protocol';
import type { GameState } from '@avalon/game-engine';

import { CommandService } from './command-service.js';
import type { ServerConfig } from './config.js';
import { createDependencyChecks } from './dependencies.js';
import {
  OutboxWorker,
  type ProjectionDelivery,
  type ProjectionPublisher,
} from './outbox-worker.js';
import { RoomService, stateFrom } from './room-service.js';
import type { RuntimePorts } from './runtime-ports.js';
import { createServer } from './server.js';
import type { SessionPresencePort } from './session-presence.js';

const migrationsDirectory = resolve(import.meta.dirname, '../migrations');
const id = (value: number): string =>
  `50000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

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
  fail = false;

  publish(delivery: ProjectionDelivery): Promise<void> {
    if (this.fail) return Promise.reject(new Error('injected publish crash'));
    this.deliveries.push(delivery);
    return Promise.resolve();
  }
}

class FixedSessionPresence implements SessionPresencePort {
  readonly clearedRoomIds: string[] = [];

  constructor(private readonly onlineIds: readonly string[]) {}

  markOnline(): Promise<void> {
    return Promise.resolve();
  }

  refresh(): Promise<void> {
    return Promise.resolve();
  }

  markOffline(): Promise<void> {
    return Promise.resolve();
  }

  onlineSessionIds(): Promise<readonly string[]> {
    return Promise.resolve(this.onlineIds);
  }

  clearRoom(roomId: string): Promise<void> {
    this.clearedRoomIds.push(roomId);
    return Promise.resolve();
  }
}

async function prepareFullLobby(
  service: RoomService,
  sql: postgres.Sql,
): Promise<{
  readonly hostToken: string;
  readonly roomId: string;
  readonly roomCode: string;
  readonly stateVersion: number;
}> {
  const created = await service.createRoom(id(100), createRequest());
  for (const [index, nickname] of [
    'Gawain',
    'Lancelot',
    'Galahad',
    'Kay',
  ].entries()) {
    await service.joinRoom(
      id(101 + index),
      created.body.roomCode,
      joinRequest(nickname),
    );
  }
  const roomId = created.body.roomView.public.roomId;
  const [row] = await sql<{ readonly aggregate: unknown }[]>`
    select aggregate from avalon_runtime.rooms where room_id = ${roomId}
  `;
  const state =
    typeof row?.aggregate === 'string'
      ? (JSON.parse(row.aggregate) as GameState)
      : (row?.aggregate as GameState);
  const readyState: GameState = {
    ...state,
    players: state.players.map((player) => ({ ...player, ready: true })),
  };
  await sql.begin(async (transaction) => {
    await transaction`
      update avalon_runtime.rooms
         set aggregate = ${transaction.json(readyState as unknown as postgres.JSONValue)}
       where room_id = ${roomId}
    `;
    await transaction`
      update avalon_runtime.players set ready = true where room_id = ${roomId}
    `;
  });
  return {
    hostToken: created.body.sessionToken,
    roomId,
    roomCode: created.body.roomCode,
    stateVersion: readyState.stateVersion,
  };
}

describe('M2-001–M2-006 PostgreSQL/Redis integration', () => {
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
      rateLimitHmacSecret: 'integration-rate-limit-material-000001',
      joinRateLimitMax: 20,
      sessionTokenPepper: 'integration-session-pepper-material-0001',
      idempotencyEncryptionSecret: 'integration-idempotency-encryption-0001',
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

  it('M2-001 applies reversible tables, constraints, indexes, cascades, and no plaintext token column', async () => {
    const tables = await sql<{ readonly table_name: string }[]>`
      select table_name from information_schema.tables
       where table_schema = 'avalon_runtime'
       order by table_name
    `;
    expect(tables.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        'outbox',
        'players',
        'processed_commands',
        'rooms',
        'sessions',
        'terminal_receipts',
      ]),
    );
    const columns = await sql<
      { readonly table_name: string; readonly column_name: string }[]
    >`
      select table_name, column_name from information_schema.columns
       where table_schema = 'avalon_runtime'
    `;
    expect(columns.some((row) => row.column_name === 'session_token')).toBe(
      false,
    );
    expect(columns).toContainEqual({
      table_name: 'sessions',
      column_name: 'token_digest',
    });

    const ports = createTestPorts().ports;
    const service = new RoomService(sql, config, ports);
    const created = await service.createRoom(id(1), createRequest());
    await sql`
      delete from avalon_runtime.rooms
       where room_id = ${created.body.roomView.public.roomId}
    `;
    const [counts] = await sql<
      {
        readonly players: number;
        readonly sessions: number;
        readonly commands: number;
        readonly outbox: number;
      }[]
    >`
      select
        (select count(*)::integer from avalon_runtime.players) as players,
        (select count(*)::integer from avalon_runtime.sessions) as sessions,
        (select count(*)::integer from avalon_runtime.processed_commands) as commands,
        (select count(*)::integer from avalon_runtime.outbox) as outbox
    `;
    expect(counts).toEqual({ players: 0, sessions: 0, commands: 0, outbox: 0 });

    await runner({
      databaseUrl,
      dir: migrationsDirectory,
      direction: 'down',
      count: 1,
      migrationsTable: 'pgmigrations',
      log: () => undefined,
    });
    const [rolledBack] = await sql<{ readonly value: string | null }[]>`
      select to_regclass('avalon_runtime.rooms')::text as value
    `;
    expect(rolledBack?.value).toBeNull();
    await runner({
      databaseUrl,
      dir: migrationsDirectory,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      log: () => undefined,
    });
  });

  it('SM-001/SM-002 creates, joins, normalizes, replays identical keys, and rejects conflicts', async () => {
    const service = new RoomService(sql, config, createTestPorts().ports);
    const request = createRequest('  A\u0301瑟  ');
    const first = await service.createRoom(id(10), request);
    const replay = await service.createRoom(id(10), request);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.body).toEqual(first.body);
    expect(first.body.roomView.public.players[0]?.nickname).toBe('Á瑟');
    await expect(
      service.createRoom(id(10), createRequest('Different')),
    ).rejects.toMatchObject({ code: 'DUPLICATE_COMMAND_CONFLICT' });
    await expect(
      service.createRoom(id(11), createRequest('玩家\u202E')),
    ).rejects.toMatchObject({ code: 'INVALID_NICKNAME' });
    await expect(
      service.createRoom(id(12), createRequest('Player', 11)),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });

    const joined = await service.joinRoom(
      id(13),
      first.body.roomCode.toLowerCase(),
      joinRequest('Guinevere'),
    );
    expect(joined.body.roomView.public.players).toHaveLength(2);
    expect(
      (
        await service.joinRoom(
          id(13),
          first.body.roomCode,
          joinRequest('Guinevere'),
        )
      ).body,
    ).toEqual(joined.body);
    await expect(
      service.joinRoom(id(14), 'AAAAAA', joinRequest('Nobody')),
    ).rejects.toMatchObject({ code: 'INVALID_ROOM_CODE' });
  });

  it('SM-002 serializes the final room slot across concurrent instances', async () => {
    const serviceA = new RoomService(sql, config, createTestPorts().ports);
    const serviceB = new RoomService(sql, config, createTestPorts().ports);
    const created = await serviceA.createRoom(id(20), createRequest());
    for (const [index, nickname] of ['P2', 'P3', 'P4'].entries()) {
      await serviceA.joinRoom(
        id(21 + index),
        created.body.roomCode,
        joinRequest(nickname),
      );
    }
    const results = await Promise.allSettled([
      serviceA.joinRoom(id(30), created.body.roomCode, joinRequest('Final A')),
      serviceB.joinRoom(id(31), created.body.roomCode, joinRequest('Final B')),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      code: 'ROOM_FULL',
    });
    const [room] = await sql<{ readonly aggregate: unknown }[]>`
      select aggregate from avalon_runtime.rooms
       where room_id = ${created.body.roomView.public.roomId}
    `;
    const roomState =
      typeof room?.aggregate === 'string'
        ? (JSON.parse(room.aggregate) as GameState)
        : (room?.aggregate as GameState);
    expect(roomState.players).toHaveLength(5);
  });

  it('AC-013 rate-limits room enumeration by HMAC(IP + installation) in Redis without leaking inputs', async () => {
    const dependencies = createDependencyChecks(config);
    const server = await createServer(
      { ...config, joinRateLimitMax: 2 },
      dependencies,
      { ports: createTestPorts().ports, startBackgroundWorkers: false },
    );
    const request = joinRequest('Enumerator');
    const send = (commandId: string, installationId = id(901)) =>
      server.app.inject({
        method: 'POST',
        url: '/v1/rooms/AAAAAA/players',
        headers: {
          'idempotency-key': commandId,
          'x-protocol-version': '1',
        },
        payload: {
          ...request,
          client: { ...request.client, installationId },
        },
      });

    try {
      expect((await send(id(32))).statusCode).toBe(404);
      expect((await send(id(33))).statusCode).toBe(404);
      const limited = await send(id(34));
      expect(limited.statusCode).toBe(429);
      expect(limited.body).not.toContain('AAAAAA');
      expect(limited.body).not.toContain('Enumerator');
      expect((await send(id(35), id(902))).statusCode).toBe(404);

      const keys = await dependencies.redis.keys('avalon:rate:*');
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.join('\n')).not.toContain('127.0.0.1');
      expect(keys.join('\n')).not.toContain(id(901));
      const ttls = await Promise.all(
        keys.map((key) => dependencies.redis.pTTL(key)),
      );
      expect(ttls.every((ttl) => ttl > 0 && ttl <= 60_000)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('SM-003 stores only digests, atomically rotates, replays its key, and permits one concurrent recovery', async () => {
    const service = new RoomService(sql, config, createTestPorts().ports);
    const created = await service.createRoom(id(40), createRequest());
    const token = created.body.sessionToken;
    const databaseText = await sql<
      {
        readonly aggregate: string;
        readonly token_digest: string;
        readonly ciphertext: string;
      }[]
    >`
      select r.aggregate::text as aggregate, s.token_digest,
             encode(p.response_ciphertext, 'escape') as ciphertext
        from avalon_runtime.rooms r
        join avalon_runtime.sessions s on s.room_id = r.room_id
        join avalon_runtime.processed_commands p on p.room_id = r.room_id
       where r.room_id = ${created.body.roomView.public.roomId}
       limit 1
    `;
    expect(JSON.stringify(databaseText)).not.toContain(token);
    expect(databaseText[0]?.token_digest).toMatch(/^[0-9a-f]{64}$/);

    const resumeRequest = { client: createRequest().client };
    const resumed = await service.resumeSession(id(41), token, resumeRequest);
    expect(resumed.body.sessionToken).not.toBe(token);
    await expect(service.authenticate(token)).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });
    expect(
      (await service.resumeSession(id(41), token, resumeRequest)).body,
    ).toEqual(resumed.body);

    const outcomes = await Promise.allSettled([
      service.resumeSession(id(42), resumed.body.sessionToken, resumeRequest),
      service.resumeSession(id(43), resumed.body.sessionToken, resumeRequest),
    ]);
    expect(
      outcomes.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
  });

  it('M2-004 commits state, processed response, and Outbox atomically; ack retry has one effect', async () => {
    const testPorts = createTestPorts();
    const service = new RoomService(sql, config, testPorts.ports);
    const lobby = await prepareFullLobby(service, sql);
    const context = await service.authenticate(lobby.hostToken);
    const command: Command = {
      commandId: id(150),
      roomId: lobby.roomId,
      expectedStateVersion: lobby.stateVersion,
      type: 'StartGame',
      payload: {},
      sentAt: '2026-08-13T10:00:00.000Z',
    };
    const commands = new CommandService(sql, config, testPorts.ports);
    const first = await commands.submit(context, command);
    const replay = await commands.submit(context, command);
    expect(first).toEqual(replay);
    expect(first).toMatchObject({ accepted: true, stateVersion: 5 });
    const [atomic] = await sql<
      {
        readonly state_version: number;
        readonly commands: number;
        readonly outbox: number;
      }[]
    >`
      select r.state_version,
             (select count(*)::integer from avalon_runtime.processed_commands p
               where p.command_id = ${command.commandId}) as commands,
             (select count(*)::integer from avalon_runtime.outbox o
               where o.room_id = r.room_id and o.state_version = r.state_version) as outbox
        from avalon_runtime.rooms r where r.room_id = ${lobby.roomId}
    `;
    expect(atomic).toEqual({ state_version: 5, commands: 1, outbox: 1 });

    const stale = await commands.submit(context, {
      ...command,
      commandId: id(151),
      type: 'ContinuePhase',
      expectedStateVersion: lobby.stateVersion,
    });
    expect(stale).toMatchObject({
      accepted: false,
      error: { code: 'STALE_VERSION', currentStateVersion: 5 },
    });
    const crossRoom = await commands.submit(context, {
      ...command,
      commandId: id(152),
      roomId: id(999),
    });
    expect(crossRoom).toMatchObject({
      accepted: false,
      error: { code: 'UNAUTHORIZED' },
    });
  });

  it('M2-006 rolls back a pre-commit crash and safely republishes the same event after a post-publish crash', async () => {
    const testPorts = createTestPorts();
    const service = new RoomService(sql, config, testPorts.ports);
    const lobby = await prepareFullLobby(service, sql);
    const context = await service.authenticate(lobby.hostToken);
    const command: Command = {
      commandId: id(160),
      roomId: lobby.roomId,
      expectedStateVersion: lobby.stateVersion,
      type: 'StartGame',
      payload: {},
      sentAt: '2026-08-13T10:00:00.000Z',
    };
    const crashingCommands = new CommandService(
      sql,
      config,
      testPorts.ports,
      () => {
        throw new Error('injected pre-commit crash');
      },
    );
    await expect(crashingCommands.submit(context, command)).rejects.toThrow(
      'injected pre-commit crash',
    );
    const [afterCrash] = await sql<
      { readonly state_version: number; readonly commands: number }[]
    >`
      select state_version,
             (select count(*)::integer from avalon_runtime.processed_commands
               where command_id = ${command.commandId}) as commands
        from avalon_runtime.rooms where room_id = ${lobby.roomId}
    `;
    expect(afterCrash).toEqual({ state_version: 4, commands: 0 });

    await new CommandService(sql, config, testPorts.ports).submit(
      context,
      command,
    );
    const publisher = new MemoryPublisher();
    let crashOnce = true;
    const worker = new OutboxWorker(sql, publisher, testPorts.ports, {
      workerId: id(170),
      batchSize: 100,
      afterPublish: () => {
        if (crashOnce) {
          crashOnce = false;
          throw new Error('injected post-publish crash');
        }
      },
    });
    publisher.fail = true;
    await worker.drainOnce();
    expect(publisher.deliveries).toHaveLength(0);
    const [afterPrePublishFailure] = await sql<{ readonly count: number }[]>`
      select count(*)::integer as count from avalon_runtime.outbox
       where room_id = ${lobby.roomId} and published_at is null
    `;
    expect(afterPrePublishFailure?.count).toBeGreaterThan(0);

    publisher.fail = false;
    testPorts.advance(250);
    await worker.drainOnce();
    const firstEventIds = publisher.deliveries.map((item) => item.eventId);
    testPorts.advance(1_000);
    await worker.drainOnce();
    expect(
      publisher.deliveries.some(
        (delivery, index) =>
          index >= firstEventIds.length &&
          firstEventIds.includes(delivery.eventId),
      ),
    ).toBe(true);
    const [pending] = await sql<{ readonly count: number }[]>`
      select count(*)::integer as count from avalon_runtime.outbox
       where room_id = ${lobby.roomId} and published_at is null
    `;
    expect(pending?.count).toBe(0);
  });

  it('M2-004 sends personalized LIVE projections across two instances and Redis loss never deletes authority', async () => {
    const dependenciesA = createDependencyChecks(config);
    const dependenciesB = createDependencyChecks(config);
    const serverA = await createServer(config, dependenciesA);
    const serverB = await createServer(config, dependenciesB);
    await serverA.app.listen({ host: '127.0.0.1', port: 0 });
    await serverB.app.listen({ host: '127.0.0.1', port: 0 });
    const addressA = serverA.app.server.address();
    const addressB = serverB.app.server.address();
    if (addressA === null || typeof addressA === 'string')
      throw new Error('no A');
    if (addressB === null || typeof addressB === 'string')
      throw new Error('no B');
    const baseA = `http://127.0.0.1:${String(addressA.port)}`;
    const baseB = `http://127.0.0.1:${String(addressB.port)}`;
    let socket: Socket | undefined;
    let joinedSocket: Socket | undefined;
    try {
      const createResponse = await fetch(`${baseA}/v1/rooms`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': id(200),
          'x-protocol-version': '1',
        },
        body: JSON.stringify(createRequest()),
      });
      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as {
        sessionToken: string;
        roomCode: string;
        playerId: string;
        roomView: { public: { roomId: string; stateVersion: number } };
      };
      const rejectedSocket = createSocketClient(`${baseA}/game-v1`, {
        transports: ['websocket'],
        reconnection: false,
        auth: {
          protocolVersion: 1,
          sessionToken: 'invalid_session_token_value_1234',
          lastStateVersion: 0,
        },
      });
      const authError = await new Promise<Error>((resolveError) => {
        rejectedSocket.once('connect_error', (error) => {
          resolveError(error);
        });
      });
      expect(authError.message).toBe('UNAUTHORIZED');
      rejectedSocket.disconnect();

      socket = createSocketClient(`${baseA}/game-v1`, {
        transports: ['websocket'],
        auth: {
          protocolVersion: 1,
          sessionToken: created.sessionToken,
          lastStateVersion: 0,
        },
      });
      const hostReady = await new Promise<{
        delivery: string;
        roomView: {
          private: { playerId: string; shouldPlayAudio: boolean };
        };
      }>((resolveReady, rejectReady) => {
        socket?.once('session.ready', (message) => {
          resolveReady(message as never);
        });
        socket?.once('connect_error', rejectReady);
      });
      expect(hostReady).toMatchObject({
        delivery: 'RESYNC',
        roomView: {
          private: { playerId: created.playerId, shouldPlayAudio: false },
        },
      });
      const liveProjection = new Promise<{
        roomView: {
          public: { players: unknown[] };
          private: { playerId: string };
        };
      }>((resolveProjection) => {
        socket?.on(
          'room.view',
          (message: {
            roomView: {
              public: { players: unknown[] };
              private: { playerId: string };
            };
          }) => {
            if (message.roomView.public.players.length === 2) {
              resolveProjection(message);
            }
          },
        );
      });
      const joinResponse = await fetch(
        `${baseB}/v1/rooms/${created.roomCode}/players`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': id(201),
            'x-protocol-version': '1',
          },
          body: JSON.stringify(joinRequest('Remote player')),
        },
      );
      expect(joinResponse.status).toBe(201);
      const joined = (await joinResponse.json()) as {
        sessionToken: string;
        playerId: string;
        roomView: { public: { players: unknown[] } };
      };
      joinedSocket = createSocketClient(`${baseB}/game-v1`, {
        transports: ['websocket'],
        auth: {
          protocolVersion: 1,
          sessionToken: joined.sessionToken,
          lastStateVersion: 0,
        },
      });
      const joinedReady = await new Promise<{
        roomView: { private: { playerId: string; shouldPlayAudio: boolean } };
      }>((resolveReady, rejectReady) => {
        joinedSocket?.once('session.ready', (message) => {
          resolveReady(message as never);
        });
        joinedSocket?.once('connect_error', rejectReady);
      });
      const projection = await Promise.race([
        liveProjection,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => {
            reject(new Error('LIVE projection timeout'));
          }, 5_000);
        }),
      ]);
      expect(projection.roomView.public.players).toHaveLength(2);
      expect(projection.roomView.private.playerId).toBe(created.playerId);
      expect(joined.roomView.public.players).toHaveLength(2);
      expect(joinedReady.roomView.private).toMatchObject({
        playerId: joined.playerId,
        selfRole: null,
        selfAlignment: null,
        knownPlayers: [],
        availableActions: [
          { commandType: 'SetReady' },
          { commandType: 'LeaveLobby' },
        ],
        hasSubmitted: false,
        shouldPlayAudio: false,
      });
      expect(
        typeof (joinedReady.roomView.private as { sessionExpiresAt?: unknown })
          .sessionExpiresAt,
      ).toBe('string');
      expect(joined.playerId).not.toBe(created.playerId);

      const forged = await new Promise<{ error: { code: string } }>(
        (resolveAck) => {
          socket?.emit(
            'command.submit',
            {
              commandId: id(202),
              roomId: created.roomView.public.roomId,
              actorPlayerId: joined.playerId,
              expectedStateVersion: created.roomView.public.stateVersion,
              type: 'SetReady',
              payload: { ready: true },
              sentAt: '2026-08-13T10:00:00.000Z',
            },
            resolveAck,
          );
        },
      );
      expect(forged.error.code).toBe('VALIDATION_ERROR');

      const crossRoom = await new Promise<{ error: { code: string } }>(
        (resolveAck) => {
          socket?.emit(
            'command.submit',
            {
              commandId: id(203),
              roomId: id(999),
              expectedStateVersion: created.roomView.public.stateVersion,
              type: 'StartGame',
              payload: {},
              sentAt: '2026-08-13T10:00:00.000Z',
            },
            resolveAck,
          );
        },
      );
      expect(crossRoom.error.code).toBe('UNAUTHORIZED');

      await dependenciesA.redis.flushAll();
      const current = await fetch(`${baseB}/v1/rooms/current/view`, {
        headers: {
          authorization: `Bearer ${created.sessionToken}`,
          'x-protocol-version': '1',
        },
      });
      expect(current.status).toBe(200);
      expect(JSON.stringify(await current.json())).not.toContain(
        created.sessionToken,
      );
    } finally {
      socket?.disconnect();
      joinedSocket?.disconnect();
      await Promise.all([serverA.close(), serverB.close()]);
    }
  }, 30_000);

  it('M2-006 prevents duplicate Outbox claims across workers and timeout cleanup cascades all transient data', async () => {
    const testPorts = createTestPorts();
    const service = new RoomService(sql, config, testPorts.ports);
    const created = await service.createRoom(id(250), createRequest());
    const publisher = new MemoryPublisher();
    const workerA = new OutboxWorker(sql, publisher, testPorts.ports, {
      workerId: id(251),
    });
    const workerB = new OutboxWorker(sql, publisher, testPorts.ports, {
      workerId: id(252),
    });
    const claims = await Promise.all([workerA.claim(), workerB.claim()]);
    expect(claims.flat()).toHaveLength(1);

    await sql`
      update avalon_runtime.rooms
         set cleanup_after = ${new Date('2026-08-13T09:59:00.000Z')}
       where room_id = ${created.body.roomView.public.roomId}
    `;
    expect(await workerA.cleanupExpiredRooms()).toBe(1);
    const [remaining] = await sql<
      {
        readonly rooms: number;
        readonly sessions: number;
        readonly outbox: number;
      }[]
    >`
      select
        (select count(*)::integer from avalon_runtime.rooms) as rooms,
        (select count(*)::integer from avalon_runtime.sessions) as sessions,
        (select count(*)::integer from avalon_runtime.outbox) as outbox
    `;
    expect(remaining).toEqual({ rooms: 0, sessions: 0, outbox: 0 });
  });

  async function prepareTerminalRoom(
    roomId: string,
    reason: 'ABORTED' | 'MERLIN_SURVIVED' = 'ABORTED',
  ): Promise<number> {
    const [row] = await sql<
      { readonly aggregate: unknown; readonly state_version: number }[]
    >`
      select aggregate, state_version from avalon_runtime.rooms
       where room_id = ${roomId}
    `;
    if (row === undefined) throw new Error('Missing room');
    const state = stateFrom(row.aggregate);
    const roleAssignments = Object.fromEntries(
      state.players.map((player, index) => [
        player.playerId,
        index === 0 ? 'MERLIN' : index === 1 ? 'ASSASSIN' : 'LOYAL_SERVANT',
      ]),
    ) as GameState['roleAssignments'];
    const terminal: GameState = {
      ...state,
      phase: 'GAME_OVER',
      phaseStage: 'RESOLVED',
      roleAssignments,
      privateKnowledge: Object.fromEntries(
        state.players.map((player) => [
          player.playerId,
          { playerId: player.playerId, knownPlayers: [] },
        ]),
      ),
      gameOutcome:
        reason === 'ABORTED'
          ? { winner: 'NONE', reason }
          : { winner: 'GOOD', reason },
    };
    await sql`
      update avalon_runtime.rooms
         set phase = 'GAME_OVER',
             aggregate = ${sql.json(terminal as unknown as postgres.JSONValue)}
       where room_id = ${roomId}
    `;
    return row.state_version;
  }

  it('M5-004 freezes online terminal targets before delivery and deletes after their acknowledgement', async () => {
    const testPorts = createTestPorts();
    const service = new RoomService(sql, config, testPorts.ports);
    const created = await service.createRoom(id(260), createRequest());
    const joined = await service.joinRoom(
      id(261),
      created.body.roomCode,
      joinRequest('Offline guest'),
    );
    const roomId = created.body.roomView.public.roomId;
    const stateVersion = await prepareTerminalRoom(roomId);
    const sessions = await sql<
      {
        readonly session_id: string;
        readonly player_id: string;
      }[]
    >`
      select session_id, player_id from avalon_runtime.sessions
       where room_id = ${roomId}
       order by player_id
    `;
    const hostSession = sessions.find(
      (session) => session.player_id === created.body.playerId,
    );
    if (hostSession === undefined) throw new Error('Missing host session');
    const presence = new FixedSessionPresence([hostSession.session_id]);
    const cleanupObservations: Array<{
      readonly trigger: 'ACK' | 'TIMEOUT' | 'NO_ONLINE_SESSIONS';
      readonly delayMs: number;
    }> = [];
    const receiptsObservedDuringPublish: number[] = [];
    const deliveries: ProjectionDelivery[] = [];
    const publisher: ProjectionPublisher = {
      async publish(delivery) {
        deliveries.push(delivery);
        const [receiptCount] = await sql<{ readonly count: number }[]>`
          select count(*)::integer as count
            from avalon_runtime.terminal_receipts
           where room_id = ${roomId}
        `;
        receiptsObservedDuringPublish.push(receiptCount?.count ?? 0);
      },
    };
    const worker = new OutboxWorker(sql, publisher, testPorts.ports, {
      workerId: id(262),
      presence,
      onTerminalCleanup: (observation) => {
        cleanupObservations.push(observation);
      },
    });

    await worker.drainOnce();
    expect(receiptsObservedDuringPublish).not.toHaveLength(0);
    expect(receiptsObservedDuringPublish.every((count) => count === 1)).toBe(
      true,
    );
    expect(deliveries).not.toHaveLength(0);
    expect(
      deliveries.every(
        (delivery) =>
          delivery.sessionId === hostSession.session_id &&
          delivery.message.roomView.public.phase === 'GAME_OVER',
      ),
    ).toBe(true);
    const context = await service.authenticate(created.body.sessionToken);
    await expect(
      service.readCurrentView(created.body.sessionToken),
    ).rejects.toMatchObject({ code: 'ROOM_EXPIRED' });
    await expect(
      service.readViewForSession(context, 'RESYNC'),
    ).rejects.toMatchObject({ code: 'ROOM_EXPIRED' });
    await expect(
      service.resumeSession(id(263), created.body.sessionToken, {
        client: createRequest().client,
      }),
    ).rejects.toMatchObject({ code: 'ROOM_EXPIRED' });
    expect(await worker.acknowledgeTerminal(context, stateVersion + 1)).toBe(
      false,
    );
    expect(await worker.acknowledgeTerminal(context, stateVersion)).toBe(true);
    const [counts] = await sql<
      {
        readonly rooms: number;
        readonly sessions: number;
        readonly receipts: number;
      }[]
    >`
      select
        (select count(*)::integer from avalon_runtime.rooms) as rooms,
        (select count(*)::integer from avalon_runtime.sessions) as sessions,
        (select count(*)::integer from avalon_runtime.terminal_receipts) as receipts
    `;
    expect(counts).toEqual({ rooms: 0, sessions: 0, receipts: 0 });
    expect(presence.clearedRoomIds).toContain(roomId);
    expect(cleanupObservations).toEqual([{ trigger: 'ACK', delayMs: 0 }]);
    await expect(
      service.authenticate(joined.body.sessionToken),
    ).rejects.toMatchObject({ code: 'SESSION_INVALID' });
  });

  it('M5-004 serializes concurrent final acknowledgements and deletes exactly once', async () => {
    const testPorts = createTestPorts();
    const service = new RoomService(sql, config, testPorts.ports);
    const created = await service.createRoom(id(270), createRequest());
    const joined = await service.joinRoom(
      id(271),
      created.body.roomCode,
      joinRequest('Online guest'),
    );
    const roomId = created.body.roomView.public.roomId;
    const stateVersion = await prepareTerminalRoom(roomId);
    const sessions = await sql<{ readonly session_id: string }[]>`
      select session_id from avalon_runtime.sessions
       where room_id = ${roomId}
       order by session_id
    `;
    const presence = new FixedSessionPresence(
      sessions.map((session) => session.session_id),
    );
    const worker = new OutboxWorker(
      sql,
      new MemoryPublisher(),
      testPorts.ports,
      { workerId: id(272), presence },
    );
    await worker.drainOnce();
    const contexts = await Promise.all([
      service.authenticate(created.body.sessionToken),
      service.authenticate(joined.body.sessionToken),
    ]);
    await expect(
      Promise.all(
        contexts.map((context) =>
          worker.acknowledgeTerminal(context, stateVersion),
        ),
      ),
    ).resolves.toEqual([true, true]);
    const [remaining] = await sql<{ readonly count: number }[]>`
      select count(*)::integer as count from avalon_runtime.rooms
       where room_id = ${roomId}
    `;
    expect(remaining?.count).toBe(0);
    expect(presence.clearedRoomIds).toEqual([roomId]);
  });

  it('M5-004 removes every transient row after the 60 second deadline', async () => {
    const testPorts = createTestPorts();
    const service = new RoomService(sql, config, testPorts.ports);
    const created = await service.createRoom(id(280), createRequest());
    const roomId = created.body.roomView.public.roomId;
    await prepareTerminalRoom(roomId);
    const [session] = await sql<{ readonly session_id: string }[]>`
      select session_id from avalon_runtime.sessions
       where room_id = ${roomId}
    `;
    if (session === undefined) throw new Error('Missing session');
    const presence = new FixedSessionPresence([session.session_id]);
    const cleanupObservations: Array<{
      readonly trigger: 'ACK' | 'TIMEOUT' | 'NO_ONLINE_SESSIONS';
      readonly delayMs: number;
    }> = [];
    const worker = new OutboxWorker(
      sql,
      new MemoryPublisher(),
      testPorts.ports,
      {
        workerId: id(281),
        presence,
        onTerminalCleanup: (observation) => {
          cleanupObservations.push(observation);
        },
      },
    );
    await worker.drainOnce();
    testPorts.advance(60_001);
    expect(await worker.cleanupExpiredRooms()).toBe(1);
    const [counts] = await sql<
      {
        readonly rooms: number;
        readonly players: number;
        readonly sessions: number;
        readonly commands: number;
        readonly outbox: number;
        readonly receipts: number;
      }[]
    >`
      select
        (select count(*)::integer from avalon_runtime.rooms) as rooms,
        (select count(*)::integer from avalon_runtime.players) as players,
        (select count(*)::integer from avalon_runtime.sessions) as sessions,
        (select count(*)::integer from avalon_runtime.processed_commands) as commands,
        (select count(*)::integer from avalon_runtime.outbox) as outbox,
        (select count(*)::integer from avalon_runtime.terminal_receipts) as receipts
    `;
    expect(counts).toEqual({
      rooms: 0,
      players: 0,
      sessions: 0,
      commands: 0,
      outbox: 0,
      receipts: 0,
    });
    expect(presence.clearedRoomIds).toContain(roomId);
    expect(cleanupObservations).toEqual([
      { trigger: 'TIMEOUT', delayMs: 60_001 },
    ]);
  });
});

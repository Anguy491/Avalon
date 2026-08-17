import { resolve } from 'node:path';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { runner } from 'node-pg-migrate';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Command, CreateRoomRequest } from '@avalon/protocol';
import type { GameState, RoleId } from '@avalon/game-engine';

import { CommandService } from './command-service.js';
import { ConnectionService } from './connection-service.js';
import type { ServerConfig } from './config.js';
import {
  OutboxWorker,
  type ProjectionDelivery,
  type ProjectionPublisher,
} from './outbox-worker.js';
import { RoomService } from './room-service.js';
import type { RuntimePorts } from './runtime-ports.js';
import type { SessionPresencePort } from './session-presence.js';

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
  roleSelection: CreateRoomRequest['config']['roleSelection'] = {
    type: 'PRESET',
    presetId: 'CLASSIC',
  },
): CreateRoomRequest {
  return {
    nickname,
    config: {
      rulesVersion: 'CLASSIC_AVALON_V1',
      playerCount,
      roleSelection,
      locale: 'zh-CN',
    },
    client: {
      protocolVersion: 2,
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
      protocolVersion: 2 as const,
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
  roleSelection?: CreateRoomRequest['config']['roleSelection'],
): Promise<Roster> {
  const created = await service.createRoom(
    id(commandIdBase),
    createRequest('HostArthur', playerCount, roleSelection),
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
    | { readonly type: 'CloseRoom'; readonly payload: Record<string, never> }
    | { readonly type: 'StartGame'; readonly payload: Record<string, never> }
    | {
        readonly type: 'ContinuePhase';
        readonly payload: Record<string, never>;
      }
    | { readonly type: 'AckRole'; readonly payload: Record<string, never> }
    | {
        readonly type: 'SubmitTeam';
        readonly payload: { readonly teamPlayerIds: readonly string[] };
      }
    | {
        readonly type: 'SubmitTeamVote';
        readonly payload: { readonly vote: 'APPROVE' | 'REJECT' };
      }
    | {
        readonly type: 'SubmitQuestChoice';
        readonly payload: { readonly choice: 'SUCCESS' | 'FAIL' };
      }
    | {
        readonly type: 'PauseGame';
        readonly payload: { readonly reason?: string };
      }
    | {
        readonly type: 'StartPauseTerminationVote';
        readonly payload: Record<string, never>;
      }
    | {
        readonly type: 'SubmitPauseTerminationVote';
        readonly payload: {
          readonly choice: 'TERMINATE' | 'CONTINUE_PAUSE';
        };
      },
): Command {
  return {
    commandId,
    roomId,
    expectedStateVersion,
    sentAt: '2026-08-13T10:00:00.000Z',
    ...body,
  } as Command;
}

async function readyRosterAndStart(
  roomService: RoomService,
  commands: CommandService,
  roster: Roster,
  commandIdBase: number,
): Promise<{
  readonly contexts: readonly Awaited<
    ReturnType<RoomService['authenticate']>
  >[];
  readonly stateVersion: number;
}> {
  const contexts = await Promise.all(
    roster.members.map((current) =>
      roomService.authenticate(current.sessionToken),
    ),
  );
  let stateVersion = roster.stateVersion;
  for (const [index, context] of contexts.entries()) {
    const ready = await commands.submit(
      context,
      lobbyCommand(id(commandIdBase + index), roster.roomId, stateVersion, {
        type: 'SetReady',
        payload: { ready: true },
      }),
    );
    if (!ready.accepted) throw new Error('expected SetReady to succeed');
    stateVersion = ready.stateVersion;
  }
  const host = contexts[0];
  if (host === undefined) throw new Error('Missing host context');
  const started = await commands.submit(
    host,
    lobbyCommand(
      id(commandIdBase + contexts.length),
      roster.roomId,
      stateVersion,
      { type: 'StartGame', payload: {} },
    ),
  );
  if (!started.accepted) throw new Error('expected StartGame to succeed');
  return { contexts, stateVersion: started.stateVersion };
}

async function advanceToTeamProposal(
  commands: CommandService,
  roster: Roster,
  contexts: readonly Awaited<ReturnType<RoomService['authenticate']>>[],
  startedVersion: number,
  commandIdBase: number,
): Promise<number> {
  const host = contexts[0];
  if (host === undefined) throw new Error('Missing host context');
  const continued = await commands.submit(
    host,
    lobbyCommand(id(commandIdBase), roster.roomId, startedVersion, {
      type: 'ContinuePhase',
      payload: {},
    }),
  );
  if (!continued.accepted) throw new Error('expected role gate to open');
  let version = continued.stateVersion;
  for (const [index, context] of contexts.entries()) {
    const acknowledged = await commands.submit(
      context,
      lobbyCommand(id(commandIdBase + index + 1), roster.roomId, version, {
        type: 'AckRole',
        payload: {},
      }),
    );
    if (!acknowledged.accepted)
      throw new Error('expected role acknowledgement');
    version = acknowledged.stateVersion;
  }
  return version;
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
      realtimePublicUrl: 'wss://localhost.invalid/game-v2',
      trustedProxyCidrs: [],
      handshakeIpRateLimit: 30,
      pendingAuthLimit: 100,
      authTimeoutMs: 3_000,
      instanceConnectionLimit: 6_000,
      globalConnectionLimit: 12_000,
      sessionSocketLimit: 2,
      terminalAckRateLimit: 3,
      audioTelemetryRateLimit: 6,
      createJoinIpRateLimit: 30,
      createJoinGlobalRateLimit: 600,
      databasePoolMax: 10,
      databaseQueryTimeoutMs: 2_000,
      outboxBatchSize: 25,
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

  it('projects availableActions by role, gates StartGame on readiness, and lists eligible kick targets', async () => {
    const testPorts = createTestPorts();
    const roomService = new RoomService(sql, config, testPorts.ports);
    const commands = new CommandService(sql, config, testPorts.ports);
    const roster = await prepareLobbyRoster(roomService, 5, 220);
    const host = member(roster, 0);
    const guest = member(roster, 1);

    const hostView = (await roomService.readCurrentView(host.sessionToken))
      .roomView;
    expect(
      hostView.private.availableActions.map((a) => a.commandType).sort(),
    ).toEqual(
      [
        'ConfigureRoom',
        'ReorderSeats',
        'KickLobbyPlayer',
        'CloseRoom',
        'SetReady',
      ].sort(),
    );
    const kickAction = hostView.private.availableActions.find(
      (a) => a.commandType === 'KickLobbyPlayer',
    );
    expect(kickAction?.eligibleTargetPlayerIds?.sort()).toEqual(
      roster.members
        .slice(1)
        .map((m) => m.playerId)
        .sort(),
    );
    // Not yet all-ready: StartGame must not be offered.
    expect(
      hostView.private.availableActions.some(
        (a) => a.commandType === 'StartGame',
      ),
    ).toBe(false);

    const guestView = (await roomService.readCurrentView(guest.sessionToken))
      .roomView;
    expect(
      guestView.private.availableActions.map((a) => a.commandType).sort(),
    ).toEqual(['SetReady', 'LeaveLobby'].sort());

    // Bring everyone to ready; then the host should see StartGame appear.
    let version = roster.stateVersion;
    for (const [index, current] of roster.members.entries()) {
      const context = await roomService.authenticate(current.sessionToken);
      const result = await commands.submit(
        context,
        lobbyCommand(id(221 + index), roster.roomId, version, {
          type: 'SetReady',
          payload: { ready: true },
        }),
      );
      if (!result.accepted) throw new Error('expected SetReady to succeed');
      version = result.stateVersion;
    }
    const hostViewReady = (await roomService.readCurrentView(host.sessionToken))
      .roomView;
    expect(
      hostViewReady.private.availableActions.some(
        (a) => a.commandType === 'StartGame',
      ),
    ).toBe(true);
  });

  it('SM-007–SM-009 projects ContinuePhase/AckRole through the complete role-reveal gate without exposing who is pending', async () => {
    const testPorts = createTestPorts();
    const roomService = new RoomService(sql, config, testPorts.ports);
    const commands = new CommandService(sql, config, testPorts.ports);
    const roster = await prepareLobbyRoster(roomService, 5, 370);
    const { contexts, stateVersion: startedVersion } =
      await readyRosterAndStart(roomService, commands, roster, 380);
    const host = contexts[0];
    const guest = contexts[1];
    if (host === undefined || guest === undefined) {
      throw new Error('Expected host and guest contexts');
    }

    const hostHeld = await roomService.readCurrentView(
      member(roster, 0).sessionToken,
    );
    const guestHeld = await roomService.readCurrentView(
      member(roster, 1).sessionToken,
    );
    expect(hostHeld.roomView.public).toMatchObject({
      phase: 'ROLE_REVEAL',
      phaseStage: 'HOST_HELD',
      submissionProgress: { submittedCount: 0, requiredCount: 5 },
    });
    expect(
      hostHeld.roomView.private.availableActions.map(
        (action) => action.commandType,
      ),
    ).toEqual(['ContinuePhase', 'PauseGame', 'ReplayAudioCue']);
    expect(guestHeld.roomView.private.availableActions).toEqual([]);

    const continued = await commands.submit(
      host,
      lobbyCommand(id(390), roster.roomId, startedVersion, {
        type: 'ContinuePhase',
        payload: {},
      }),
    );
    if (!continued.accepted) throw new Error('expected ContinuePhase to pass');

    for (const current of roster.members) {
      const collecting = await roomService.readCurrentView(
        current.sessionToken,
      );
      expect(collecting.roomView.public.phaseStage).toBe('COLLECTING');
      expect(
        collecting.roomView.private.availableActions.map(
          (action) => action.commandType,
        ),
      ).toEqual(
        current.playerId === host.playerId
          ? ['AckRole', 'PauseGame', 'ReplayAudioCue']
          : ['AckRole'],
      );
    }

    const firstAck = await commands.submit(
      guest,
      lobbyCommand(id(391), roster.roomId, continued.stateVersion, {
        type: 'AckRole',
        payload: {},
      }),
    );
    if (!firstAck.accepted) throw new Error('expected AckRole to pass');
    const guestAfterAck = await roomService.readCurrentView(
      member(roster, 1).sessionToken,
    );
    expect(guestAfterAck.roomView.private).toMatchObject({
      hasSubmitted: true,
      availableActions: [],
    });
    expect(guestAfterAck.roomView.public.submissionProgress).toEqual({
      submittedCount: 1,
      requiredCount: 5,
    });
    expect(guestAfterAck.roomView.public).not.toHaveProperty(
      'submittedPlayerIds',
    );

    let version = firstAck.stateVersion;
    for (const [index, context] of contexts.entries()) {
      if (index === 1) continue;
      const acknowledgement = await commands.submit(
        context,
        lobbyCommand(id(392 + index), roster.roomId, version, {
          type: 'AckRole',
          payload: {},
        }),
      );
      if (!acknowledgement.accepted) {
        throw new Error('expected remaining AckRole to pass');
      }
      version = acknowledgement.stateVersion;
    }
    const afterAll = await roomService.readCurrentView(
      member(roster, 0).sessionToken,
    );
    expect(afterAll.roomView.public).toMatchObject({
      phase: 'TEAM_PROPOSAL',
      phaseStage: 'HOST_HELD',
    });
    expect(afterAll.roomView.private.selfRole).not.toBeNull();
  });

  it('SM-020–SM-023 persists a one-hour pause, snapshots online voters, and settles the 30-second ballot', async () => {
    const testPorts = createTestPorts();
    const roomService = new RoomService(sql, config, testPorts.ports);
    const commands = new CommandService(sql, config, testPorts.ports);
    const roster = await prepareLobbyRoster(roomService, 5, 395);
    const started = await readyRosterAndStart(
      roomService,
      commands,
      roster,
      405,
    );
    const guest = started.contexts[1];
    const host = started.contexts[0];
    if (guest === undefined || host === undefined) {
      throw new Error('Missing recovery test contexts');
    }
    let expired = true;
    const presence: SessionPresencePort = {
      markOnline: () => Promise.resolve(),
      refresh: () => Promise.resolve(true),
      markOffline: () => Promise.resolve(),
      onlineSessionIds: () => Promise.resolve([]),
      clearRoom: () => Promise.resolve(),
      claimExpired: () => {
        if (!expired) return Promise.resolve([]);
        expired = false;
        return Promise.resolve([
          {
            sessionId: guest.sessionId,
            roomId: guest.roomId,
            playerId: guest.playerId,
          },
        ]);
      },
    };
    const connections = new ConnectionService(sql, testPorts.ports, presence);
    await connections.tick();
    const [persistedPause] = await sql<
      {
        readonly recovery_started_at: Date | null;
        readonly recovery_expires_at: Date | null;
        readonly aggregate_started_at: string | null;
        readonly aggregate_expires_at: string | null;
      }[]
    >`
      select recovery_started_at, recovery_expires_at,
             aggregate ->> 'recoveryStartedAt' as aggregate_started_at,
             aggregate ->> 'recoveryExpiresAt' as aggregate_expires_at
        from avalon_runtime.rooms where room_id = ${roster.roomId}
    `;
    expect(persistedPause).toMatchObject({
      recovery_started_at: new Date('2026-08-13T10:00:00.000Z'),
      recovery_expires_at: new Date('2026-08-13T11:00:00.000Z'),
      aggregate_started_at: '2026-08-13T10:00:00.000Z',
      aggregate_expires_at: '2026-08-13T11:00:00.000Z',
    });
    const paused = (
      await roomService.readCurrentView(roster.members[0]?.sessionToken ?? '')
    ).roomView;
    expect(paused.public).toMatchObject({
      phase: 'PAUSED',
      pauseReasons: ['PLAYER_DISCONNECTED'],
      recoveryStartedAt: '2026-08-13T10:00:00.000Z',
      recoveryExpiresAt: '2026-08-13T11:00:00.000Z',
      pauseTerminationVoteAvailableAt: '2026-08-13T10:01:00.000Z',
    });
    expect(paused.private.selfRole).not.toBeNull();

    await connections.markConnected(roster.roomId, guest.playerId);
    const resumed = (
      await roomService.readCurrentView(roster.members[0]?.sessionToken ?? '')
    ).roomView;
    expect(resumed.public).toMatchObject({
      phase: 'ROLE_REVEAL',
      pauseReasons: [],
      recoveryStartedAt: null,
      recoveryExpiresAt: null,
    });
    expect(resumed.private.selfRole).toBe(paused.private.selfRole);

    const manual = await commands.submit(
      host,
      lobbyCommand(id(420), roster.roomId, resumed.public.stateVersion, {
        type: 'PauseGame',
        payload: { reason: '休息' },
      }),
    );
    if (!manual.accepted) throw new Error('Expected manual pause');
    testPorts.advance(60_000);
    const eligible = (
      await roomService.readCurrentView(roster.members[1]?.sessionToken ?? '')
    ).roomView;
    expect(eligible.private.availableActions).toContainEqual({
      commandType: 'StartPauseTerminationVote',
    });
    const startedVote = await commands.submit(
      guest,
      lobbyCommand(id(421), roster.roomId, manual.stateVersion, {
        type: 'StartPauseTerminationVote',
        payload: {},
      }),
    );
    if (!startedVote.accepted) throw new Error('Expected pause vote to start');
    let voteVersion = startedVote.stateVersion;
    for (const [index, context] of started.contexts.slice(0, 3).entries()) {
      const continuedPause = await commands.submit(
        context,
        lobbyCommand(id(422 + index), roster.roomId, voteVersion, {
          type: 'SubmitPauseTerminationVote',
          payload: { choice: 'CONTINUE_PAUSE' },
        }),
      );
      if (!continuedPause.accepted) {
        throw new Error('Expected continue-pause vote');
      }
      voteVersion = continuedPause.stateVersion;
    }
    const continued = (
      await roomService.readCurrentView(roster.members[0]?.sessionToken ?? '')
    ).roomView;
    expect(continued.public).toMatchObject({
      phase: 'PAUSED',
      pauseTerminationVote: null,
      pauseTerminationVoteAvailableAt: '2026-08-13T10:02:00.000Z',
    });

    testPorts.advance(60_000);
    const secondVote = await commands.submit(
      host,
      lobbyCommand(id(426), roster.roomId, voteVersion, {
        type: 'StartPauseTerminationVote',
        payload: {},
      }),
    );
    if (!secondVote.accepted) throw new Error('Expected second pause vote');
    testPorts.advance(30_000);
    await connections.tick();
    const [terminal] = await sql<{ readonly aggregate: unknown }[]>`
      select aggregate from avalon_runtime.rooms where room_id = ${roster.roomId}
    `;
    const terminalState =
      typeof terminal?.aggregate === 'string'
        ? (JSON.parse(terminal.aggregate) as GameState)
        : (terminal?.aggregate as GameState);
    expect(terminalState).toMatchObject({
      phase: 'GAME_OVER',
      gameOutcome: { winner: 'NONE', reason: 'ABORTED' },
    });
  });

  it('RULE-006–RULE-007 / AC-008 sends each 10-player special-role knowledge projection only to its bound session', async () => {
    const testPorts = createTestPorts();
    const roomService = new RoomService(sql, config, testPorts.ports);
    const commands = new CommandService(sql, config, testPorts.ports);
    const roleIds: RoleId[] = [
      'MERLIN',
      'PERCIVAL',
      'LOYAL_SERVANT',
      'LOYAL_SERVANT',
      'LOYAL_SERVANT',
      'LOYAL_SERVANT',
      'ASSASSIN',
      'MORGANA',
      'MORDRED',
      'OBERON',
    ];
    const roster = await prepareLobbyRoster(roomService, 10, 410, {
      type: 'CUSTOM',
      roleIds,
    });
    const { stateVersion } = await readyRosterAndStart(
      roomService,
      commands,
      roster,
      430,
    );
    const [row] = await sql<{ readonly aggregate: unknown }[]>`
      select aggregate from avalon_runtime.rooms where room_id = ${roster.roomId}
    `;
    const state =
      typeof row?.aggregate === 'string'
        ? (JSON.parse(row.aggregate) as GameState)
        : (row?.aggregate as GameState);
    const roleFor = (playerId: string) => {
      const roleId = state.roleAssignments[playerId];
      if (roleId === undefined) throw new Error('Missing role assignment');
      return roleId;
    };
    const evilRoles = new Set<RoleId>([
      'ASSASSIN',
      'MINION',
      'MORGANA',
      'MORDRED',
      'OBERON',
    ]);
    const isEvil = (roleId: RoleId) => evilRoles.has(roleId);
    const expectedKnowledge = (viewerId: string) => {
      const viewerRole = roleFor(viewerId);
      if (viewerRole === 'MERLIN') {
        return state.players
          .filter((player) => {
            const roleId = roleFor(player.playerId);
            return isEvil(roleId) && roleId !== 'MORDRED';
          })
          .map((player) => ({
            playerId: player.playerId,
            knowledgeLabel: 'EVIL_PLAYER' as const,
          }));
      }
      if (viewerRole === 'PERCIVAL') {
        return state.players
          .filter((player) => {
            const roleId = roleFor(player.playerId);
            return roleId === 'MERLIN' || roleId === 'MORGANA';
          })
          .map((player) => ({
            playerId: player.playerId,
            knowledgeLabel: 'MERLIN_CANDIDATE' as const,
          }));
      }
      if (isEvil(viewerRole) && viewerRole !== 'OBERON') {
        return state.players
          .filter((player) => {
            const roleId = roleFor(player.playerId);
            return (
              player.playerId !== viewerId &&
              isEvil(roleId) &&
              roleId !== 'OBERON'
            );
          })
          .map((player) => ({
            playerId: player.playerId,
            knowledgeLabel: 'KNOWN_EVIL_ALLY' as const,
          }));
      }
      return [];
    };

    const views = await Promise.all(
      roster.members.map(async (current) => ({
        playerId: current.playerId,
        sessionToken: current.sessionToken,
        roomView: (await roomService.readCurrentView(current.sessionToken))
          .roomView,
      })),
    );
    for (const { playerId, sessionToken, roomView } of views) {
      const ownRole = roleFor(playerId);
      expect(roomView.private).toMatchObject({
        playerId,
        selfRole: ownRole,
        selfAlignment: isEvil(ownRole) ? 'EVIL' : 'GOOD',
        knownPlayers: expectedKnowledge(playerId),
      });
      expect(roomView.public.revealedAssignments).toEqual([]);
      expect(roomView.public).not.toHaveProperty('roleAssignments');
      expect(roomView.public).not.toHaveProperty('privateKnowledge');
      expect(JSON.stringify(roomView)).not.toContain(sessionToken);
    }

    const [startEvent] = await sql<{ readonly event_id: string }[]>`
      select event_id
        from avalon_runtime.outbox
       where room_id = ${roster.roomId}
         and state_version = ${stateVersion}
    `;
    if (startEvent === undefined)
      throw new Error('Missing StartGame outbox row');
    const publisher = new MemoryPublisher();
    const worker = new OutboxWorker(sql, publisher, testPorts.ports, {
      workerId: id(450),
      batchSize: 500,
    });
    await worker.drainOnce();
    const startDeliveries = publisher.deliveries.filter(
      (delivery) =>
        delivery.message.roomView.public.roomId === roster.roomId &&
        delivery.eventId === startEvent.event_id,
    );
    expect(startDeliveries).toHaveLength(10);
    for (const delivery of startDeliveries) {
      expect(delivery.message.roomView.private).toMatchObject({
        playerId: delivery.playerId,
        selfRole: roleFor(delivery.playerId),
        knownPlayers: expectedKnowledge(delivery.playerId),
      });
    }
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
            roleSelection: { type: 'PRESET', presetId: 'RECOMMENDED' },
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
            roleSelection: { type: 'PRESET', presetId: 'RECOMMENDED' },
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

  it('M4-001–M4-006 projects gated actions, reveals votes together, and settles one anonymous quest exactly once', async () => {
    const testPorts = createTestPorts();
    const roomService = new RoomService(sql, config, testPorts.ports);
    const commandsA = new CommandService(sql, config, testPorts.ports);
    const commandsB = new CommandService(sql, config, testPorts.ports);
    const roster = await prepareLobbyRoster(roomService, 5, 700);
    const started = await readyRosterAndStart(
      roomService,
      commandsA,
      roster,
      710,
    );
    let version = await advanceToTeamProposal(
      commandsA,
      roster,
      started.contexts,
      started.stateVersion,
      720,
    );
    const host = started.contexts[0];
    if (host === undefined) throw new Error('Missing host context');

    const heldViews = await Promise.all(
      roster.members.map((current) =>
        roomService.readCurrentView(current.sessionToken),
      ),
    );
    const leaderPlayerId = heldViews[0]?.roomView.public.leaderPlayerId;
    const leaderIndex = roster.members.findIndex(
      (current) => current.playerId === leaderPlayerId,
    );
    const leader = started.contexts[leaderIndex];
    if (leader === undefined) throw new Error('Missing leader context');
    expect(
      heldViews[0]?.roomView.private.availableActions.map(
        (action) => action.commandType,
      ),
    ).toEqual(['ContinuePhase', 'PauseGame', 'ReplayAudioCue']);

    const proposalOpened = await commandsA.submit(
      host,
      lobbyCommand(id(730), roster.roomId, version, {
        type: 'ContinuePhase',
        payload: {},
      }),
    );
    if (!proposalOpened.accepted) throw new Error('expected proposal gate');
    version = proposalOpened.stateVersion;
    const collectingViews = await Promise.all(
      roster.members.map((current) =>
        roomService.readCurrentView(current.sessionToken),
      ),
    );
    expect(
      collectingViews[leaderIndex]?.roomView.private.availableActions.map(
        (action) => action.commandType,
      ),
    ).toEqual(['SubmitTeam']);
    for (const [index, view] of collectingViews.entries()) {
      if (index !== leaderIndex) {
        expect(view.roomView.private.availableActions).toEqual(
          index === 0
            ? [{ commandType: 'PauseGame' }, { commandType: 'ReplayAudioCue' }]
            : [],
        );
      }
    }

    const goodIndex = collectingViews.findIndex(
      (view) => view.roomView.private.selfAlignment === 'GOOD',
    );
    const evilIndex = collectingViews.findIndex(
      (view) => view.roomView.private.selfAlignment === 'EVIL',
    );
    if (goodIndex < 0 || evilIndex < 0) throw new Error('Missing alignments');
    const teamPlayerIds = [
      member(roster, goodIndex).playerId,
      member(roster, evilIndex).playerId,
    ];
    const proposed = await commandsA.submit(
      leader,
      lobbyCommand(id(731), roster.roomId, version, {
        type: 'SubmitTeam',
        payload: { teamPlayerIds },
      }),
    );
    if (!proposed.accepted) throw new Error('expected team proposal');
    version = proposed.stateVersion;
    const proposedView = await roomService.readCurrentView(
      member(roster, 1).sessionToken,
    );
    expect(proposedView.roomView.public).toMatchObject({
      phase: 'TEAM_VOTE',
      phaseStage: 'HOST_HELD',
      proposedTeamPlayerIds: teamPlayerIds,
    });

    const voteOpened = await commandsA.submit(
      host,
      lobbyCommand(id(732), roster.roomId, version, {
        type: 'ContinuePhase',
        payload: {},
      }),
    );
    if (!voteOpened.accepted) throw new Error('expected vote gate');
    version = voteOpened.stateVersion;
    for (const current of roster.members) {
      const view = await roomService.readCurrentView(current.sessionToken);
      expect(view.roomView.private.availableActions).toEqual([
        {
          commandType: 'SubmitTeamVote',
          allowedTeamVotes: ['APPROVE', 'REJECT'],
        },
        ...(current.playerId === host.playerId
          ? [
              { commandType: 'PauseGame' as const },
              { commandType: 'ReplayAudioCue' as const },
            ]
          : []),
      ]);
    }

    for (let index = 0; index < roster.members.length - 1; index += 1) {
      const context = started.contexts[index];
      if (context === undefined) throw new Error('Missing voter');
      const voted = await commandsA.submit(
        context,
        lobbyCommand(id(733 + index), roster.roomId, version, {
          type: 'SubmitTeamVote',
          payload: { vote: 'APPROVE' },
        }),
      );
      if (!voted.accepted) throw new Error('expected team vote');
      version = voted.stateVersion;
    }
    const beforeLastVote = await roomService.readCurrentView(
      member(roster, 0).sessionToken,
    );
    expect(beforeLastVote.roomView.public.submissionProgress).toEqual({
      submittedCount: 4,
      requiredCount: 5,
    });
    expect(beforeLastVote.roomView.public.proposalHistory).toEqual([]);
    expect(JSON.stringify(beforeLastVote.roomView.public)).not.toContain(
      'APPROVE',
    );

    const lastVoter = started.contexts[4];
    if (lastVoter === undefined) throw new Error('Missing last voter');
    const [lastApprove, lastReject] = await Promise.all([
      commandsA.submit(
        lastVoter,
        lobbyCommand(id(740), roster.roomId, version, {
          type: 'SubmitTeamVote',
          payload: { vote: 'APPROVE' },
        }),
      ),
      commandsB.submit(
        lastVoter,
        lobbyCommand(id(741), roster.roomId, version, {
          type: 'SubmitTeamVote',
          payload: { vote: 'REJECT' },
        }),
      ),
    ]);
    const acceptedVote = [lastApprove, lastReject].find(
      (result) => result.accepted,
    );
    expect(
      [lastApprove, lastReject].filter((result) => result.accepted),
    ).toHaveLength(1);
    expect(
      [lastApprove, lastReject].filter((result) => !result.accepted),
    ).toHaveLength(1);
    if (acceptedVote === undefined) {
      throw new Error('Missing accepted last vote');
    }
    version = acceptedVote.stateVersion;
    const voteResult = await roomService.readCurrentView(
      member(roster, 0).sessionToken,
    );
    const revealedProposal = voteResult.roomView.public.proposalHistory[0];
    expect(revealedProposal).toMatchObject({ approved: true });
    expect(revealedProposal?.approveCount).toBeGreaterThanOrEqual(4);
    expect(
      (revealedProposal?.approveCount ?? 0) +
        (revealedProposal?.rejectCount ?? 0),
    ).toBe(5);
    expect(revealedProposal?.votes).toHaveLength(5);
    expect(voteResult.roomView.private.availableActions).toEqual([
      { commandType: 'ContinuePhase' },
      { commandType: 'PauseGame' },
      { commandType: 'ReplayAudioCue' },
    ]);

    const questHeld = await commandsA.submit(
      host,
      lobbyCommand(id(742), roster.roomId, version, {
        type: 'ContinuePhase',
        payload: {},
      }),
    );
    if (!questHeld.accepted) throw new Error('expected quest transition');
    const questOpened = await commandsA.submit(
      host,
      lobbyCommand(id(743), roster.roomId, questHeld.stateVersion, {
        type: 'ContinuePhase',
        payload: {},
      }),
    );
    if (!questOpened.accepted) throw new Error('expected quest gate');
    version = questOpened.stateVersion;

    const questViews = await Promise.all(
      roster.members.map((current) =>
        roomService.readCurrentView(current.sessionToken),
      ),
    );
    expect(questViews[goodIndex]?.roomView.private.availableActions).toEqual([
      {
        commandType: 'SubmitQuestChoice',
        allowedQuestChoices: ['SUCCESS'],
      },
      ...(roster.members[goodIndex]?.playerId === host.playerId
        ? [{ commandType: 'PauseGame' }, { commandType: 'ReplayAudioCue' }]
        : []),
    ]);
    expect(questViews[evilIndex]?.roomView.private.availableActions).toEqual([
      {
        commandType: 'SubmitQuestChoice',
        allowedQuestChoices: ['SUCCESS', 'FAIL'],
      },
      ...(roster.members[evilIndex]?.playerId === host.playerId
        ? [{ commandType: 'PauseGame' }, { commandType: 'ReplayAudioCue' }]
        : []),
    ]);
    const nonTeamIndex = roster.members.findIndex(
      (current) => !teamPlayerIds.includes(current.playerId),
    );
    const nonTeam = started.contexts[nonTeamIndex];
    if (nonTeam === undefined) throw new Error('Missing non-team player');
    const illegalNonTeam = await commandsA.submit(
      nonTeam,
      lobbyCommand(id(744), roster.roomId, version, {
        type: 'SubmitQuestChoice',
        payload: { choice: 'SUCCESS' },
      }),
    );
    expect(illegalNonTeam).toMatchObject({
      accepted: false,
      error: { code: 'PLAYER_NOT_ON_TEAM' },
    });
    const good = started.contexts[goodIndex];
    const evil = started.contexts[evilIndex];
    if (good === undefined || evil === undefined) {
      throw new Error('Missing quest contexts');
    }
    const illegalGoodFail = await commandsA.submit(
      good,
      lobbyCommand(id(745), roster.roomId, version, {
        type: 'SubmitQuestChoice',
        payload: { choice: 'FAIL' },
      }),
    );
    expect(illegalGoodFail).toMatchObject({
      accepted: false,
      error: { code: 'GOOD_CANNOT_FAIL' },
    });

    const firstChoice = await commandsA.submit(
      good,
      lobbyCommand(id(746), roster.roomId, version, {
        type: 'SubmitQuestChoice',
        payload: { choice: 'SUCCESS' },
      }),
    );
    if (!firstChoice.accepted) throw new Error('expected first quest choice');
    version = firstChoice.stateVersion;
    const beforeLastChoice = await roomService.readCurrentView(
      member(roster, evilIndex).sessionToken,
    );
    expect(beforeLastChoice.roomView.public.submissionProgress).toEqual({
      submittedCount: 1,
      requiredCount: 2,
    });
    expect(beforeLastChoice.roomView.public.questHistory).toEqual([]);
    expect(beforeLastChoice.roomView.public).not.toHaveProperty(
      'submittedPlayerIds',
    );

    const [lastSuccess, lastFail] = await Promise.all([
      commandsA.submit(
        evil,
        lobbyCommand(id(747), roster.roomId, version, {
          type: 'SubmitQuestChoice',
          payload: { choice: 'SUCCESS' },
        }),
      ),
      commandsB.submit(
        evil,
        lobbyCommand(id(748), roster.roomId, version, {
          type: 'SubmitQuestChoice',
          payload: { choice: 'FAIL' },
        }),
      ),
    ]);
    const acceptedChoice = [lastSuccess, lastFail].find(
      (result) => result.accepted,
    );
    expect(
      [lastSuccess, lastFail].filter((result) => result.accepted),
    ).toHaveLength(1);
    expect(
      [lastSuccess, lastFail].filter((result) => !result.accepted),
    ).toHaveLength(1);
    if (acceptedChoice === undefined) {
      throw new Error('Missing accepted last quest choice');
    }
    const questResult = await roomService.readCurrentView(
      member(roster, 0).sessionToken,
    );
    expect(questResult.roomView.public.phase).toBe('QUEST_RESOLUTION');
    expect(questResult.roomView.public.questHistory).toHaveLength(1);
    const settledQuest = questResult.roomView.public.questHistory[0];
    expect(
      (settledQuest?.successChoices ?? 0) + (settledQuest?.failChoices ?? 0),
    ).toBe(2);
    expect(settledQuest).not.toHaveProperty('questChoices');
    expect(settledQuest).not.toHaveProperty('choicesByPlayer');
    expect(questResult.roomView.private.availableActions).toEqual([
      { commandType: 'ContinuePhase' },
      { commandType: 'PauseGame' },
      { commandType: 'ReplayAudioCue' },
    ]);
  });

  it('RULE-010 / AC-003 rejects a six-player 3:3 tie and rotates the leader without advancing the quest', async () => {
    const testPorts = createTestPorts();
    const roomService = new RoomService(sql, config, testPorts.ports);
    const commands = new CommandService(sql, config, testPorts.ports);
    const roster = await prepareLobbyRoster(roomService, 6, 800);
    const started = await readyRosterAndStart(
      roomService,
      commands,
      roster,
      810,
    );
    let version = await advanceToTeamProposal(
      commands,
      roster,
      started.contexts,
      started.stateVersion,
      820,
    );
    const host = started.contexts[0];
    if (host === undefined) throw new Error('Missing host context');
    const opened = await commands.submit(
      host,
      lobbyCommand(id(830), roster.roomId, version, {
        type: 'ContinuePhase',
        payload: {},
      }),
    );
    if (!opened.accepted) throw new Error('expected proposal gate');
    version = opened.stateVersion;
    const proposalView = await roomService.readCurrentView(
      member(roster, 0).sessionToken,
    );
    const leaderIndex = roster.members.findIndex(
      (current) =>
        current.playerId === proposalView.roomView.public.leaderPlayerId,
    );
    const leader = started.contexts[leaderIndex];
    if (leader === undefined) throw new Error('Missing leader context');
    const originalLeaderId = leader.playerId;
    const proposed = await commands.submit(
      leader,
      lobbyCommand(id(831), roster.roomId, version, {
        type: 'SubmitTeam',
        payload: {
          teamPlayerIds: roster.members
            .slice(0, 2)
            .map((item) => item.playerId),
        },
      }),
    );
    if (!proposed.accepted) throw new Error('expected team proposal');
    const voteOpened = await commands.submit(
      host,
      lobbyCommand(id(832), roster.roomId, proposed.stateVersion, {
        type: 'ContinuePhase',
        payload: {},
      }),
    );
    if (!voteOpened.accepted) throw new Error('expected vote gate');
    version = voteOpened.stateVersion;
    for (const [index, context] of started.contexts.entries()) {
      const voted = await commands.submit(
        context,
        lobbyCommand(id(833 + index), roster.roomId, version, {
          type: 'SubmitTeamVote',
          payload: { vote: index < 3 ? 'APPROVE' : 'REJECT' },
        }),
      );
      if (!voted.accepted) throw new Error('expected tied vote');
      version = voted.stateVersion;
    }
    const result = await roomService.readCurrentView(
      member(roster, 0).sessionToken,
    );
    expect(result.roomView.public).toMatchObject({
      phase: 'TEAM_VOTE',
      phaseStage: 'RESOLVED',
      questIndex: 1,
      proposalAttempt: 2,
    });
    expect(result.roomView.public.leaderPlayerId).not.toBe(originalLeaderId);
    expect(result.roomView.public.proposalHistory.at(-1)).toMatchObject({
      approveCount: 3,
      rejectCount: 3,
      approved: false,
    });
  });

  it('RULE-011 / AC-004 locks evil victory after the fifth rejected team without entering a quest', async () => {
    const testPorts = createTestPorts();
    const roomService = new RoomService(sql, config, testPorts.ports);
    const commands = new CommandService(sql, config, testPorts.ports);
    const roster = await prepareLobbyRoster(roomService, 5, 900);
    const started = await readyRosterAndStart(
      roomService,
      commands,
      roster,
      910,
    );
    let version = await advanceToTeamProposal(
      commands,
      roster,
      started.contexts,
      started.stateVersion,
      920,
    );
    const host = started.contexts[0];
    if (host === undefined) throw new Error('Missing host context');

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const opened = await commands.submit(
        host,
        lobbyCommand(id(930 + attempt * 20), roster.roomId, version, {
          type: 'ContinuePhase',
          payload: {},
        }),
      );
      if (!opened.accepted) throw new Error('expected proposal gate');
      version = opened.stateVersion;
      const view = await roomService.readCurrentView(
        member(roster, 0).sessionToken,
      );
      const leaderIndex = roster.members.findIndex(
        (current) => current.playerId === view.roomView.public.leaderPlayerId,
      );
      const leader = started.contexts[leaderIndex];
      if (leader === undefined) throw new Error('Missing leader context');
      const proposed = await commands.submit(
        leader,
        lobbyCommand(id(931 + attempt * 20), roster.roomId, version, {
          type: 'SubmitTeam',
          payload: {
            teamPlayerIds: roster.members
              .slice(0, view.roomView.public.requiredTeamSize ?? 2)
              .map((item) => item.playerId),
          },
        }),
      );
      if (!proposed.accepted) throw new Error('expected team proposal');
      const voteOpened = await commands.submit(
        host,
        lobbyCommand(
          id(932 + attempt * 20),
          roster.roomId,
          proposed.stateVersion,
          {
            type: 'ContinuePhase',
            payload: {},
          },
        ),
      );
      if (!voteOpened.accepted) throw new Error('expected vote gate');
      version = voteOpened.stateVersion;
      for (const [index, context] of started.contexts.entries()) {
        const rejected = await commands.submit(
          context,
          lobbyCommand(id(933 + attempt * 20 + index), roster.roomId, version, {
            type: 'SubmitTeamVote',
            payload: { vote: 'REJECT' },
          }),
        );
        if (!rejected.accepted) throw new Error('expected rejected vote');
        version = rejected.stateVersion;
      }
      if (attempt < 5) {
        const continued = await commands.submit(
          host,
          lobbyCommand(id(945 + attempt * 20), roster.roomId, version, {
            type: 'ContinuePhase',
            payload: {},
          }),
        );
        if (!continued.accepted) throw new Error('expected next proposal');
        version = continued.stateVersion;
      }
    }

    const result = await roomService.readCurrentView(
      member(roster, 0).sessionToken,
    );
    expect(result.roomView.public).toMatchObject({
      phase: 'TEAM_VOTE',
      phaseStage: 'RESOLVED',
      questIndex: 1,
      proposalAttempt: 5,
      successCount: 0,
      failureCount: 0,
      gameOutcome: {
        winner: 'EVIL',
        reason: 'FIVE_REJECTED_TEAMS',
      },
    });
    expect(result.roomView.public.proposalHistory).toHaveLength(5);
    expect(result.roomView.public.questHistory).toEqual([]);
  });

  it('RULE-014 / AC-006 applies the two-fail threshold to the fourth quest for seven players', async () => {
    const runFourthQuest = async (
      failSubmissions: 1 | 2,
      commandIdBase: number,
    ) => {
      const testPorts = createTestPorts();
      const roomService = new RoomService(sql, config, testPorts.ports);
      const commands = new CommandService(sql, config, testPorts.ports);
      const roster = await prepareLobbyRoster(roomService, 7, commandIdBase);
      const started = await readyRosterAndStart(
        roomService,
        commands,
        roster,
        commandIdBase + 20,
      );
      const [row] = await sql<{ readonly aggregate: unknown }[]>`
        select aggregate
          from avalon_runtime.rooms
         where room_id = ${roster.roomId}
      `;
      const state =
        typeof row?.aggregate === 'string'
          ? (JSON.parse(row.aggregate) as GameState)
          : (row?.aggregate as GameState);
      const evilRoles = new Set<RoleId>([
        'ASSASSIN',
        'MINION',
        'MORGANA',
        'MORDRED',
        'OBERON',
      ]);
      const evilPlayers = state.players.filter((player) => {
        const roleId = state.roleAssignments[player.playerId];
        return roleId !== undefined && evilRoles.has(roleId);
      });
      const goodPlayers = state.players.filter(
        (player) =>
          !evilPlayers.some((evil) => evil.playerId === player.playerId),
      );
      const team = [...evilPlayers.slice(0, 2), ...goodPlayers.slice(0, 2)];
      if (team.length !== 4) throw new Error('Missing fourth-quest team');
      const questState: GameState = {
        ...state,
        phase: 'QUEST_SUBMISSION',
        phaseStage: 'COLLECTING',
        questIndex: 4,
        proposalAttempt: 1,
        proposedTeam: team.map((player) => player.playerId),
        teamVotes: {},
        questChoices: {},
        roleAcknowledgements: [],
        proposalHistory: [],
        questHistory: [],
        successCount: 0,
        failureCount: 0,
        pendingTransition: undefined,
      };
      await sql`
        update avalon_runtime.rooms
           set phase = 'QUEST_SUBMISSION',
               aggregate = ${sql.json(questState as unknown as postgres.JSONValue)}
         where room_id = ${roster.roomId}
      `;
      const before = await roomService.readCurrentView(
        member(roster, 0).sessionToken,
      );
      expect(before.roomView.public.requiredQuestFails).toBe(2);

      let version = started.stateVersion;
      for (const [index, player] of team.entries()) {
        const contextIndex = roster.members.findIndex(
          (current) => current.playerId === player.playerId,
        );
        const context = started.contexts[contextIndex];
        if (context === undefined) throw new Error('Missing quest context');
        const choice = await commands.submit(
          context,
          lobbyCommand(id(commandIdBase + 40 + index), roster.roomId, version, {
            type: 'SubmitQuestChoice',
            payload: {
              choice: index < failSubmissions && index < 2 ? 'FAIL' : 'SUCCESS',
            },
          }),
        );
        if (!choice.accepted) throw new Error('expected quest choice');
        version = choice.stateVersion;
      }
      const after = await roomService.readCurrentView(
        member(roster, 0).sessionToken,
      );
      const settled = after.roomView.public.questHistory.at(-1);
      await sql`
        delete from avalon_runtime.rooms where room_id = ${roster.roomId}
      `;
      return settled;
    };

    await expect(runFourthQuest(1, 1_100)).resolves.toMatchObject({
      questIndex: 4,
      failChoices: 1,
      requiredFails: 2,
      result: 'SUCCESS',
    });
    await expect(runFourthQuest(2, 1_200)).resolves.toMatchObject({
      questIndex: 4,
      failChoices: 2,
      requiredFails: 2,
      result: 'FAILURE',
    });
  });
});

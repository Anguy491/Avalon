import type postgres from 'postgres';

import {
  assertGameInvariants,
  buildPrivatePlayerState,
  buildPublicGameState,
  createInitialGameState,
  normalizeRoomConfig,
  type GameState,
  type Player,
  type RoleId,
  type RoomConfigInput as EngineRoomConfigInput,
} from '@avalon/game-engine';
import {
  SessionBootstrapSchema,
  createProtocolValidator,
  type ClientCapabilities,
  type CreateRoomRequest,
  type ErrorCode,
  type JoinRoomRequest,
  type PrivatePlayerProjection,
  type PublicSnapshot,
  type ReadRoomViewResponse,
  type ResumeSessionRequest,
  type RoomView,
  type SessionBootstrap,
} from '@avalon/protocol';

import type { ServerConfig } from './config.js';
import type { RuntimePorts } from './runtime-ports.js';
import {
  addSeconds,
  decryptJson,
  encryptJson,
  issueRoomCode,
  issueSessionToken,
  normalizeNickname,
  sha256Digest,
  tokenDigest,
} from './security.js';
import type { SessionContext } from './session-context.js';

const ROOM_CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
const MAX_ROOM_CODE_ATTEMPTS = 16;
const SCHEMA = 'avalon_runtime';
const validateSessionBootstrap = createProtocolValidator().compile(
  SessionBootstrapSchema,
);

type Transaction = postgres.TransactionSql;

interface ProcessedRow {
  readonly request_digest: string;
  readonly auth_token_digest: string | null;
  readonly response_status: number;
  readonly response_ciphertext: Uint8Array;
  readonly response_iv: Uint8Array;
  readonly response_tag: Uint8Array;
  readonly state_version: number;
}

interface RoomRow {
  readonly room_id: string;
  readonly room_code: string;
  readonly state_version: number;
  readonly phase: string;
  readonly aggregate: unknown;
}

interface SessionRow {
  readonly session_id: string;
  readonly token_family: string;
  readonly room_id: string;
  readonly player_id: string;
  readonly token_digest: string;
  readonly expires_at: Date;
  readonly room_code: string;
  readonly aggregate: unknown;
}

export interface ServiceResponse<T> {
  readonly status: number;
  readonly body: T;
  readonly idempotentReplay: boolean;
}

export class ServiceError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly httpStatus: number,
    readonly retryable = false,
    readonly currentStateVersion?: number,
  ) {
    super(code);
    this.name = 'ServiceError';
  }
}

export function stateFrom(value: unknown): GameState {
  if (typeof value === 'string') {
    try {
      return stateFrom(JSON.parse(value) as unknown);
    } catch {
      throw new ServiceError('INTERNAL_ERROR', 500, true);
    }
  }
  if (typeof value !== 'object' || value === null) {
    throw new ServiceError('INTERNAL_ERROR', 500, true);
  }
  return value as GameState;
}

function chooseVoicePack(client: ClientCapabilities): string | undefined {
  return client.voicePackVersions.includes('zh-CN-v1') ? 'zh-CN-v1' : undefined;
}

export function toEngineConfig(
  input: CreateRoomRequest['config'],
): EngineRoomConfigInput {
  return {
    rulesVersion: input.rulesVersion,
    playerCount: input.playerCount,
    roleSelection:
      input.roleSelection.type === 'PRESET'
        ? { ...input.roleSelection }
        : {
            type: 'CUSTOM',
            roleIds: input.roleSelection.roleIds as readonly RoleId[],
          },
    locale: input.locale,
  };
}

function proposalHistory(state: GameState): PublicSnapshot['proposalHistory'] {
  return state.proposalHistory.map((record) => ({
    questIndex: record.questIndex,
    proposalAttempt: record.proposalAttempt,
    leaderPlayerId: record.leaderPlayerId,
    teamPlayerIds: [...record.teamPlayerIds],
    votes: state.players
      .slice()
      .sort((left, right) => left.seat - right.seat)
      .map((player) => {
        const vote = record.votes[player.playerId];
        if (vote === undefined) {
          throw new ServiceError('INTERNAL_ERROR', 500, false);
        }
        return { playerId: player.playerId, vote };
      }),
    approved: record.approved,
  }));
}

type AvailableAction = PrivatePlayerProjection['availableActions'][number];

// Computes which commands the requesting player may currently submit, for UI
// affordance only. This mirrors *eligibility gates* already enforced by
// packages/game-engine (host-only, phase, phaseStage, already-submitted) so
// clients can disable/enable controls without guessing — it deliberately does
// NOT re-derive any secret or vote-counting logic; the engine remains the
// sole source of truth and re-validates every command on submission.
// M3 covers LOBBY and ROLE_REVEAL (identity reveal); later gameplay phases
// (TEAM_PROPOSAL onward) are left as an explicit follow-up for a later slice.
function computeAvailableActions(
  state: GameState,
  playerId: string,
  hasSubmitted: boolean,
): readonly AvailableAction[] {
  const isHost = state.hostPlayerId === playerId;

  if (state.phase === 'LOBBY') {
    const actions: AvailableAction[] = [{ commandType: 'SetReady' }];
    if (isHost) {
      actions.push(
        { commandType: 'ConfigureRoom' },
        { commandType: 'ReorderSeats' },
      );
      const canStart =
        state.players.length === state.config.playerCount &&
        state.players.every((player) => player.ready && player.connected);
      if (canStart) actions.push({ commandType: 'StartGame' });
      actions.push({
        commandType: 'KickLobbyPlayer',
        eligibleTargetPlayerIds: state.players
          .filter((player) => player.playerId !== playerId)
          .map((player) => player.playerId),
      });
      actions.push({ commandType: 'CloseRoom' });
    } else {
      actions.push({ commandType: 'LeaveLobby' });
    }
    return actions;
  }

  if (state.phase === 'ROLE_REVEAL') {
    if (state.phaseStage === 'HOST_HELD') {
      return isHost ? [{ commandType: 'ContinuePhase' }] : [];
    }
    if (state.phaseStage === 'COLLECTING' && !hasSubmitted) {
      return [{ commandType: 'AckRole' }];
    }
  }

  return [];
}

function projectRoom(
  roomId: string,
  roomCode: string,
  state: GameState,
  playerId: string,
  sessionExpiresAt: Date,
  delivery: 'LIVE' | 'RESYNC',
): RoomView {
  const publicGame = buildPublicGameState(state);
  const privateGame = buildPrivatePlayerState(state, playerId);
  const publicSnapshot: PublicSnapshot = {
    roomId,
    roomCode,
    stateVersion: publicGame.stateVersion,
    rulesVersion: state.config.rulesVersion,
    config: {
      ...state.config,
      roleIds: [...state.config.roleIds],
    },
    phase: publicGame.phase,
    phaseStage: publicGame.phaseStage,
    players: state.players
      .slice()
      .sort((left, right) => left.seat - right.seat)
      .map((player) => ({ ...player })),
    leaderPlayerId: state.phase === 'LOBBY' ? null : publicGame.leaderPlayerId,
    questIndex: state.phase === 'LOBBY' ? null : publicGame.questIndex,
    proposalAttempt: publicGame.proposalAttempt,
    requiredTeamSize:
      state.phase === 'LOBBY' ? null : publicGame.requiredTeamSize,
    proposedTeamPlayerIds: [...publicGame.proposedTeam],
    submissionProgress: publicGame.submissionProgress ?? null,
    proposalHistory: proposalHistory(state),
    questHistory: publicGame.questHistory.map((record) => ({
      ...record,
      teamPlayerIds: [...record.teamPlayerIds],
    })),
    successCount: publicGame.successCount,
    failureCount: publicGame.failureCount,
    pauseReasons: [...publicGame.pauseReasons],
    currentAudioCue: publicGame.currentAudioCue ?? null,
    gameOutcome: publicGame.gameOutcome ?? null,
    revealedAssignments: [...publicGame.revealedAssignments],
  };
  const privateProjection: PrivatePlayerProjection = {
    playerId: privateGame.playerId,
    selfRole: privateGame.selfRole ?? null,
    selfAlignment: privateGame.selfAlignment ?? null,
    knownPlayers: [...privateGame.knownPlayers],
    availableActions: [
      ...computeAvailableActions(state, playerId, privateGame.hasSubmitted),
    ],
    hasSubmitted: privateGame.hasSubmitted,
    shouldPlayAudio: delivery === 'LIVE' && false,
    sessionExpiresAt: sessionExpiresAt.toISOString(),
  };
  return { public: publicSnapshot, private: privateProjection };
}

function bootstrap(
  config: ServerConfig,
  roomId: string,
  roomCode: string,
  playerId: string,
  token: string,
  expiresAt: Date,
  state: GameState,
): SessionBootstrap {
  return {
    protocolVersion: 1,
    roomCode,
    playerId,
    sessionToken: token,
    sessionExpiresAt: expiresAt.toISOString(),
    realtimeUrl: config.realtimePublicUrl,
    roomView: projectRoom(
      roomId,
      roomCode,
      state,
      playerId,
      expiresAt,
      'RESYNC',
    ),
  };
}

async function advisoryLock(
  sql: Transaction,
  scope: string,
  commandId: string,
): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`${scope}:${commandId}`}, 0))`;
}

export class RoomService {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly config: ServerConfig,
    private readonly ports: RuntimePorts,
  ) {}

  private async replay(
    sql: Transaction,
    scope: string,
    commandId: string,
    requestDigest: string,
    authTokenDigest?: string,
  ): Promise<ServiceResponse<SessionBootstrap> | undefined> {
    const [row] = await sql<ProcessedRow[]>`
      select request_digest, auth_token_digest, response_status,
             response_ciphertext, response_iv, response_tag, state_version
        from ${sql(SCHEMA)}.processed_commands
       where scope = ${scope} and command_id = ${commandId}
    `;
    if (row === undefined) return undefined;
    if (
      row.request_digest !== requestDigest ||
      (authTokenDigest !== undefined &&
        row.auth_token_digest !== authTokenDigest)
    ) {
      throw new ServiceError('DUPLICATE_COMMAND_CONFLICT', 409, false);
    }
    const body = decryptJson(
      {
        ciphertext: row.response_ciphertext,
        iv: row.response_iv,
        tag: row.response_tag,
      },
      this.config.idempotencyEncryptionSecret,
    );
    if (!validateSessionBootstrap(body)) {
      throw new ServiceError('INTERNAL_ERROR', 500, true);
    }
    return {
      status: row.response_status,
      body: body as SessionBootstrap,
      idempotentReplay: true,
    };
  }

  private async saveProcessed(
    sql: Transaction,
    input: {
      readonly scope: string;
      readonly commandId: string;
      readonly roomId: string;
      readonly tokenFamily?: string;
      readonly authTokenDigest?: string;
      readonly requestDigest: string;
      readonly status: number;
      readonly body: unknown;
      readonly stateVersion: number;
      readonly now: Date;
    },
  ): Promise<void> {
    const encrypted = encryptJson(
      input.body,
      this.config.idempotencyEncryptionSecret,
      this.ports.random,
    );
    await sql`
      insert into ${sql(SCHEMA)}.processed_commands
        (scope, command_id, room_id, token_family, auth_token_digest,
         request_digest, response_status, response_ciphertext, response_iv,
         response_tag, state_version, created_at)
      values
        (${input.scope}, ${input.commandId}, ${input.roomId},
         ${input.tokenFamily ?? null}, ${input.authTokenDigest ?? null},
         ${input.requestDigest}, ${input.status},
         ${Buffer.from(encrypted.ciphertext)}, ${Buffer.from(encrypted.iv)},
         ${Buffer.from(encrypted.tag)}, ${input.stateVersion}, ${input.now})
    `;
  }

  private async addOutbox(
    sql: Transaction,
    roomId: string,
    stateVersion: number,
    now: Date,
  ): Promise<void> {
    await sql`
      insert into ${sql(SCHEMA)}.outbox
        (outbox_id, event_id, room_id, state_version, event_type,
         created_at, available_at)
      values
        (${this.ports.ids.next()}, ${this.ports.ids.next()}, ${roomId},
         ${stateVersion}, 'ROOM_VIEW_CHANGED', ${now}, ${now})
      on conflict (room_id, state_version, event_type) do nothing
    `;
  }

  async createRoom(
    commandId: string,
    request: CreateRoomRequest,
  ): Promise<ServiceResponse<SessionBootstrap>> {
    const scope = 'POST /v1/rooms';
    const requestHash = sha256Digest(request);
    const normalized = normalizeNickname(request.nickname);
    if (!normalized.ok) {
      throw new ServiceError('INVALID_NICKNAME', 400, false);
    }
    const voicePackVersion = chooseVoicePack(request.client);
    if (voicePackVersion === undefined) {
      throw new ServiceError('INVALID_CONFIG', 400, false);
    }
    const normalizedConfig = normalizeRoomConfig(
      toEngineConfig(request.config),
      voicePackVersion,
    );
    if (!normalizedConfig.ok) {
      throw new ServiceError('INVALID_CONFIG', 400, false);
    }

    return this.sql.begin(async (sql) => {
      await advisoryLock(sql, scope, commandId);
      const replay = await this.replay(sql, scope, commandId, requestHash);
      if (replay !== undefined) return replay;

      const now = this.ports.clock.now();
      const roomId = this.ports.ids.next();
      const playerId = this.ports.ids.next();
      const sessionId = this.ports.ids.next();
      const tokenFamily = this.ports.ids.next();
      const token = issueSessionToken(this.ports.random);
      const digest = tokenDigest(token, this.config.sessionTokenPepper);
      const expiresAt = addSeconds(now, this.config.sessionTtlSeconds);
      const player: Player = {
        playerId,
        nickname: normalized.nickname,
        seat: 0,
        isHost: true,
        ready: false,
        connected: true,
      };
      const state = createInitialGameState(normalizedConfig.config, [player]);
      let roomCode: string | undefined;
      for (
        let attempt = 0;
        attempt < MAX_ROOM_CODE_ATTEMPTS && roomCode === undefined;
        attempt += 1
      ) {
        const candidate = issueRoomCode(this.ports.random);
        const inserted = await sql<{ readonly room_id: string }[]>`
          insert into ${sql(SCHEMA)}.rooms
            (room_id, room_code, state_version, phase, aggregate,
             created_at, last_active_at)
          values
            (${roomId}, ${candidate}, ${state.stateVersion}, ${state.phase},
             ${sql.json(state as unknown as postgres.JSONValue)}, ${now}, ${now})
          on conflict (room_code) do nothing
          returning room_id
        `;
        if (inserted.length === 1) roomCode = candidate;
      }
      if (roomCode === undefined) {
        throw new ServiceError('INTERNAL_ERROR', 500, true);
      }

      await sql`
        insert into ${sql(SCHEMA)}.players
          (player_id, room_id, nickname, normalized_nickname, seat, is_host,
           connected, ready, created_at)
        values
          (${playerId}, ${roomId}, ${normalized.nickname},
           ${normalized.comparison}, 0, true, true, false, ${now})
      `;
      await sql`
        insert into ${sql(SCHEMA)}.sessions
          (session_id, token_family, room_id, player_id, token_digest,
           expires_at, created_at)
        values
          (${sessionId}, ${tokenFamily}, ${roomId}, ${playerId}, ${digest},
           ${expiresAt}, ${now})
      `;
      await this.addOutbox(sql, roomId, state.stateVersion, now);

      const body = bootstrap(
        this.config,
        roomId,
        roomCode,
        playerId,
        token,
        expiresAt,
        state,
      );
      await this.saveProcessed(sql, {
        scope,
        commandId,
        roomId,
        tokenFamily,
        requestDigest: requestHash,
        status: 201,
        body,
        stateVersion: state.stateVersion,
        now,
      });
      return { status: 201, body, idempotentReplay: false };
    });
  }

  async joinRoom(
    commandId: string,
    rawRoomCode: string,
    request: JoinRoomRequest,
  ): Promise<ServiceResponse<SessionBootstrap>> {
    const roomCode = rawRoomCode.toUpperCase();
    if (!ROOM_CODE_PATTERN.test(roomCode)) {
      throw new ServiceError('INVALID_ROOM_CODE', 404, false);
    }
    const normalized = normalizeNickname(request.nickname);
    if (!normalized.ok) {
      throw new ServiceError('INVALID_NICKNAME', 400, false);
    }
    const requestHash = sha256Digest({ roomCode, request });
    const scope = 'POST /v1/rooms/:roomCode/players';

    return this.sql.begin(async (sql) => {
      await advisoryLock(sql, scope, commandId);
      const replay = await this.replay(sql, scope, commandId, requestHash);
      if (replay !== undefined) return replay;

      const [room] = await sql<RoomRow[]>`
        select room_id, room_code, state_version, phase, aggregate
          from ${sql(SCHEMA)}.rooms
         where room_code = ${roomCode}
         for update
      `;
      if (room === undefined) {
        throw new ServiceError('INVALID_ROOM_CODE', 404, false);
      }
      const state = stateFrom(room.aggregate);
      if (state.phase !== 'LOBBY') {
        throw new ServiceError('ROOM_NOT_JOINABLE', 409, false);
      }
      if (state.players.length >= state.config.playerCount) {
        throw new ServiceError('ROOM_FULL', 409, false);
      }
      const conflicts = await sql<{ readonly exists: boolean }[]>`
        select exists(
          select 1 from ${sql(SCHEMA)}.players
           where room_id = ${room.room_id}
             and normalized_nickname = ${normalized.comparison}
        ) as exists
      `;
      if (conflicts[0]?.exists === true) {
        throw new ServiceError('NICKNAME_CONFLICT', 409, false);
      }

      const now = this.ports.clock.now();
      const playerId = this.ports.ids.next();
      const sessionId = this.ports.ids.next();
      const tokenFamily = this.ports.ids.next();
      const token = issueSessionToken(this.ports.random);
      const digest = tokenDigest(token, this.config.sessionTokenPepper);
      const expiresAt = addSeconds(now, this.config.sessionTtlSeconds);
      const player: Player = {
        playerId,
        nickname: normalized.nickname,
        seat: state.players.length,
        isHost: false,
        ready: false,
        connected: true,
      };
      const nextState: GameState = {
        ...state,
        stateVersion: state.stateVersion + 1,
        players: [...state.players, player],
      };
      assertGameInvariants(nextState);

      await sql`
        update ${sql(SCHEMA)}.rooms
           set state_version = ${nextState.stateVersion}, phase = ${nextState.phase},
               aggregate = ${sql.json(nextState as unknown as postgres.JSONValue)},
               last_active_at = ${now}
         where room_id = ${room.room_id}
      `;
      await sql`
        insert into ${sql(SCHEMA)}.players
          (player_id, room_id, nickname, normalized_nickname, seat, is_host,
           connected, ready, created_at)
        values
          (${playerId}, ${room.room_id}, ${normalized.nickname},
           ${normalized.comparison}, ${player.seat}, false, true, false, ${now})
      `;
      await sql`
        insert into ${sql(SCHEMA)}.sessions
          (session_id, token_family, room_id, player_id, token_digest,
           expires_at, created_at)
        values
          (${sessionId}, ${tokenFamily}, ${room.room_id}, ${playerId},
           ${digest}, ${expiresAt}, ${now})
      `;
      await this.addOutbox(sql, room.room_id, nextState.stateVersion, now);

      const body = bootstrap(
        this.config,
        room.room_id,
        room.room_code,
        playerId,
        token,
        expiresAt,
        nextState,
      );
      await this.saveProcessed(sql, {
        scope,
        commandId,
        roomId: room.room_id,
        tokenFamily,
        requestDigest: requestHash,
        status: 201,
        body,
        stateVersion: nextState.stateVersion,
        now,
      });
      return { status: 201, body, idempotentReplay: false };
    });
  }

  async resumeSession(
    commandId: string,
    oldToken: string,
    request: ResumeSessionRequest,
  ): Promise<ServiceResponse<SessionBootstrap>> {
    const oldDigest = tokenDigest(oldToken, this.config.sessionTokenPepper);
    const requestHash = sha256Digest({ tokenDigest: oldDigest, request });
    const scope = 'POST /v1/sessions/resume';

    return this.sql.begin(async (sql) => {
      await advisoryLock(sql, scope, commandId);
      const replay = await this.replay(
        sql,
        scope,
        commandId,
        requestHash,
        oldDigest,
      );
      if (replay !== undefined) return replay;

      const [session] = await sql<SessionRow[]>`
        select s.session_id, s.token_family, s.room_id, s.player_id,
               s.token_digest, s.expires_at, r.room_code, r.aggregate
          from ${sql(SCHEMA)}.sessions s
          join ${sql(SCHEMA)}.rooms r on r.room_id = s.room_id
         where s.token_digest = ${oldDigest}
           and s.revoked_at is null
           and s.expires_at > ${this.ports.clock.now()}
         for update of s
      `;
      if (session === undefined) {
        throw new ServiceError('SESSION_INVALID', 401, false);
      }
      const [lockedRoom] = await sql<RoomRow[]>`
        select room_id, room_code, state_version, phase, aggregate
          from ${sql(SCHEMA)}.rooms
         where room_id = ${session.room_id}
         for update
      `;
      if (lockedRoom === undefined) {
        throw new ServiceError('ROOM_EXPIRED', 410, false);
      }

      const now = this.ports.clock.now();
      const newToken = issueSessionToken(this.ports.random);
      const newDigest = tokenDigest(newToken, this.config.sessionTokenPepper);
      const expiresAt = addSeconds(now, this.config.sessionTtlSeconds);
      await sql`
        update ${sql(SCHEMA)}.sessions
           set token_digest = ${newDigest}, expires_at = ${expiresAt},
               rotated_at = ${now}
         where session_id = ${session.session_id}
      `;
      const state = stateFrom(lockedRoom.aggregate);
      const body = bootstrap(
        this.config,
        session.room_id,
        session.room_code,
        session.player_id,
        newToken,
        expiresAt,
        state,
      );
      await this.saveProcessed(sql, {
        scope,
        commandId,
        roomId: session.room_id,
        tokenFamily: session.token_family,
        authTokenDigest: oldDigest,
        requestDigest: requestHash,
        status: 200,
        body,
        stateVersion: state.stateVersion,
        now,
      });
      return { status: 200, body, idempotentReplay: false };
    });
  }

  async authenticate(token: string): Promise<SessionContext> {
    const digest = tokenDigest(token, this.config.sessionTokenPepper);
    const [session] = await this.sql<SessionRow[]>`
      select s.session_id, s.token_family, s.room_id, s.player_id,
             s.token_digest, s.expires_at, r.room_code, r.aggregate
        from ${this.sql(SCHEMA)}.sessions s
        join ${this.sql(SCHEMA)}.rooms r on r.room_id = s.room_id
       where s.token_digest = ${digest}
         and s.revoked_at is null
         and s.expires_at > ${this.ports.clock.now()}
    `;
    if (session === undefined) {
      throw new ServiceError('SESSION_INVALID', 401, false);
    }
    return {
      sessionId: session.session_id,
      tokenFamily: session.token_family,
      roomId: session.room_id,
      playerId: session.player_id,
      tokenDigest: session.token_digest,
      expiresAt: session.expires_at,
    };
  }

  async readCurrentView(token: string): Promise<ReadRoomViewResponse> {
    const context = await this.authenticate(token);
    const [room] = await this.sql<RoomRow[]>`
      select room_id, room_code, state_version, phase, aggregate
        from ${this.sql(SCHEMA)}.rooms
       where room_id = ${context.roomId}
    `;
    if (room === undefined) {
      throw new ServiceError('ROOM_EXPIRED', 410, false);
    }
    return {
      protocolVersion: 1,
      roomView: projectRoom(
        room.room_id,
        room.room_code,
        stateFrom(room.aggregate),
        context.playerId,
        context.expiresAt,
        'RESYNC',
      ),
    };
  }

  async readViewForSession(
    context: SessionContext,
    delivery: 'LIVE' | 'RESYNC',
  ): Promise<RoomView> {
    const [room] = await this.sql<RoomRow[]>`
      select room_id, room_code, state_version, phase, aggregate
        from ${this.sql(SCHEMA)}.rooms
       where room_id = ${context.roomId}
    `;
    if (room === undefined) throw new ServiceError('ROOM_EXPIRED', 410);
    return projectRoom(
      room.room_id,
      room.room_code,
      stateFrom(room.aggregate),
      context.playerId,
      context.expiresAt,
      delivery,
    );
  }
}

export { projectRoom };

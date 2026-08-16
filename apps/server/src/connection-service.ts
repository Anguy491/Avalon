import type postgres from 'postgres';

import {
  PAUSE_TERMINATION_VOTE_DELAY_MS,
  applyConnectionChanged,
  expirePauseTerminationVote,
  expirePausedGame,
  type DomainEffect,
  type EnginePorts,
  type GameState,
} from '@avalon/game-engine';

import type { RuntimePorts } from './runtime-ports.js';
import { stateFrom } from './room-service.js';
import type { SessionContext } from './session-context.js';
import type {
  ExpiredSessionLease,
  SessionPresencePort,
} from './session-presence.js';

const SCHEMA = 'avalon_runtime';
const LOBBY_RECOVERY_WINDOW_MS = 30 * 60 * 1_000;
const PAUSED_RECOVERY_WINDOW_MS = 60 * 60 * 1_000;

interface RoomRow {
  readonly room_id: string;
  readonly aggregate: unknown;
  readonly phase: string;
  readonly recovery_started_at: Date | null;
  readonly recovery_expires_at: Date | null;
  readonly pause_vote_expires_at: Date | null;
}

interface ReconciliationRow {
  readonly session_id: string;
  readonly token_family: string;
  readonly room_id: string;
  readonly player_id: string;
  readonly token_digest: string;
  readonly credential_generation: number;
  readonly expires_at: Date;
}

function enginePorts(ports: RuntimePorts): EnginePorts {
  return {
    random: ports.random,
    clock: {
      nowIso: () => ports.clock.now().toISOString(),
      addMilliseconds: (iso, milliseconds) =>
        new Date(Date.parse(iso) + milliseconds).toISOString(),
    },
    ids: { nextId: () => ports.ids.next() },
  };
}

function withRecoveryWindow(
  state: GameState,
  now: Date,
  persisted: Pick<RoomRow, 'recovery_started_at' | 'recovery_expires_at'>,
): GameState {
  const needsWindow =
    state.phase === 'PAUSED' ||
    (state.phase === 'LOBBY' &&
      state.players.some((player) => player.isHost && !player.connected));
  if (!needsWindow) {
    return {
      ...state,
      recoveryStartedAt: undefined,
      recoveryExpiresAt: undefined,
      pauseTerminationVoteAvailableAt: undefined,
      pauseTerminationVote: undefined,
    };
  }
  if (
    (state.recoveryStartedAt !== undefined ||
      persisted.recovery_started_at !== null) &&
    (state.recoveryExpiresAt !== undefined ||
      persisted.recovery_expires_at !== null)
  ) {
    const recoveryStartedAt =
      state.recoveryStartedAt ?? persisted.recovery_started_at?.toISOString();
    if (recoveryStartedAt === undefined) {
      throw new Error('Recovery state lost its start time');
    }
    const recoveryWindowMs =
      state.phase === 'PAUSED'
        ? PAUSED_RECOVERY_WINDOW_MS
        : LOBBY_RECOVERY_WINDOW_MS;
    return {
      ...state,
      recoveryStartedAt,
      recoveryExpiresAt: new Date(
        Date.parse(recoveryStartedAt) + recoveryWindowMs,
      ).toISOString(),
      ...(state.phase === 'PAUSED'
        ? {
            pauseTerminationVoteAvailableAt:
              state.pauseTerminationVoteAvailableAt ??
              new Date(
                Date.parse(recoveryStartedAt) + PAUSE_TERMINATION_VOTE_DELAY_MS,
              ).toISOString(),
          }
        : {}),
    };
  }
  const recoveryWindowMs =
    state.phase === 'PAUSED'
      ? PAUSED_RECOVERY_WINDOW_MS
      : LOBBY_RECOVERY_WINDOW_MS;
  return {
    ...state,
    recoveryStartedAt: now.toISOString(),
    recoveryExpiresAt: new Date(now.getTime() + recoveryWindowMs).toISOString(),
    ...(state.phase === 'PAUSED'
      ? {
          pauseTerminationVoteAvailableAt: new Date(
            now.getTime() + PAUSE_TERMINATION_VOTE_DELAY_MS,
          ).toISOString(),
        }
      : {}),
  };
}

function liveAudioCueId(effects: readonly DomainEffect[]): string | null {
  return (
    effects.find((effect) => effect.type === 'AUDIO_CUE_REQUESTED')?.cue
      .audioCueId ?? null
  );
}

export class ConnectionService {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private lastReconciledAt = 0;

  constructor(
    private readonly sql: postgres.Sql,
    private readonly ports: RuntimePorts,
    private readonly presence: SessionPresencePort,
  ) {}

  start(intervalMs = 250): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      if (this.running !== undefined) return;
      const current = this.tick()
        .catch(() => undefined)
        .finally(() => {
          if (this.running === current) this.running = undefined;
        });
      this.running = current;
    }, intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  async markConnected(roomId: string, playerId: string): Promise<void> {
    await this.applyConnection(roomId, playerId, true);
  }

  async tick(): Promise<void> {
    const now = this.ports.clock.now();
    if (now.getTime() - this.lastReconciledAt >= 2_500) {
      await this.reconcileMissingLeases(now);
      this.lastReconciledAt = now.getTime();
    }
    const expired = (await this.presence.claimExpired?.(now)) ?? [];
    for (const lease of expired) await this.markExpired(lease);
    await this.expirePauseVotes(now);
    await this.expireRecoveryWindows(now);
  }

  private async reconcileMissingLeases(now: Date): Promise<void> {
    if (this.presence.hasActiveSession === undefined) return;
    const rows = await this.sql<ReconciliationRow[]>`
      select distinct on (p.room_id, p.player_id)
             s.session_id, s.token_family, s.room_id, s.player_id,
             s.token_digest, s.credential_generation, s.expires_at
        from ${this.sql(SCHEMA)}.players p
        join ${this.sql(SCHEMA)}.rooms r on r.room_id = p.room_id
        join ${this.sql(SCHEMA)}.sessions s
          on s.room_id = p.room_id and s.player_id = p.player_id
       where p.connected = true
         and r.phase <> 'GAME_OVER'
         and s.revoked_at is null
         and s.expires_at > ${now}
       order by p.room_id, p.player_id, s.created_at desc
    `;
    for (const row of rows) {
      if (await this.presence.hasActiveSession(row.session_id)) continue;
      const context: SessionContext = {
        sessionId: row.session_id,
        tokenFamily: row.token_family,
        roomId: row.room_id,
        playerId: row.player_id,
        tokenDigest: row.token_digest,
        credentialGeneration: row.credential_generation,
        expiresAt: row.expires_at,
      };
      await this.presence.markOnline(
        context,
        `reconcile:${this.ports.ids.next()}`,
        now,
      );
    }
  }

  private markExpired(lease: ExpiredSessionLease): Promise<void> {
    return this.applyConnection(lease.roomId, lease.playerId, false);
  }

  private async applyConnection(
    roomId: string,
    playerId: string,
    connected: boolean,
  ): Promise<void> {
    await this.sql.begin(async (sql) => {
      const [room] = await sql<RoomRow[]>`
        select room_id, aggregate, phase,
               recovery_started_at, recovery_expires_at,
               pause_vote_expires_at
          from ${sql(SCHEMA)}.rooms
         where room_id = ${roomId}
         for update
      `;
      if (room === undefined || room.phase === 'GAME_OVER') return;
      const state = stateFrom(room.aggregate);
      const transition = applyConnectionChanged(state, playerId, connected);
      if (transition.state === state) return;
      const now = this.ports.clock.now();
      const windowed = withRecoveryWindow(transition.state, now, room);
      const recoveryStartedAt =
        windowed.phase === 'PAUSED' ||
        (windowed.phase === 'LOBBY' &&
          windowed.players.some((player) => player.isHost && !player.connected))
          ? (room.recovery_started_at ?? now)
          : null;
      const recoveryExpiresAt =
        recoveryStartedAt === null
          ? null
          : new Date(
              recoveryStartedAt.getTime() +
                (windowed.phase === 'PAUSED'
                  ? PAUSED_RECOVERY_WINDOW_MS
                  : LOBBY_RECOVERY_WINDOW_MS),
            );
      const next: GameState = {
        ...windowed,
        recoveryStartedAt: recoveryStartedAt?.toISOString(),
        recoveryExpiresAt: recoveryExpiresAt?.toISOString(),
      };
      if (recoveryStartedAt === null || recoveryExpiresAt === null) {
        await sql`
          update ${sql(SCHEMA)}.rooms
             set state_version = ${next.stateVersion}, phase = ${next.phase},
                 aggregate = ${sql.json(next as unknown as postgres.JSONValue)},
                 recovery_started_at = null, recovery_expires_at = null,
                 pause_vote_expires_at = null,
                 last_active_at = ${now}
           where room_id = ${roomId}
        `;
      } else {
        await sql`
          update ${sql(SCHEMA)}.rooms
             set state_version = ${next.stateVersion}, phase = ${next.phase},
                 aggregate = ${sql.json(next as unknown as postgres.JSONValue)},
                 recovery_started_at = ${recoveryStartedAt},
                 recovery_expires_at = ${recoveryExpiresAt},
                 pause_vote_expires_at = ${next.pauseTerminationVote?.expiresAt ?? null},
                 last_active_at = ${now}
           where room_id = ${roomId}
        `;
      }
      await sql`
        update ${sql(SCHEMA)}.players set connected = ${connected}
         where room_id = ${roomId} and player_id = ${playerId}
      `;
      await this.addOutbox(sql, roomId, next.stateVersion, null, now);
    });
  }

  private async expirePauseVotes(now: Date): Promise<void> {
    const rooms = await this.sql<RoomRow[]>`
      select room_id, aggregate, phase, recovery_started_at,
             recovery_expires_at, pause_vote_expires_at
        from ${this.sql(SCHEMA)}.rooms
       where pause_vote_expires_at <= ${now}
       order by pause_vote_expires_at
       limit 25
    `;
    for (const candidate of rooms) {
      await this.sql.begin(async (sql) => {
        const [room] = await sql<RoomRow[]>`
          select room_id, aggregate, phase, recovery_started_at,
                 recovery_expires_at, pause_vote_expires_at
            from ${sql(SCHEMA)}.rooms
           where room_id = ${candidate.room_id}
             and pause_vote_expires_at <= ${now}
           for update skip locked
        `;
        if (room === undefined) return;
        const state = stateFrom(room.aggregate);
        const transition = expirePauseTerminationVote(
          state,
          enginePorts(this.ports),
        );
        if (transition.state === state) return;
        const next = transition.state;
        await sql`
          update ${sql(SCHEMA)}.rooms
             set state_version = ${next.stateVersion}, phase = ${next.phase},
                 aggregate = ${sql.json(next as unknown as postgres.JSONValue)},
                 recovery_started_at = null, recovery_expires_at = null,
                 pause_vote_expires_at = null, last_active_at = ${now}
           where room_id = ${room.room_id}
        `;
        await this.addOutbox(
          sql,
          room.room_id,
          next.stateVersion,
          liveAudioCueId(transition.effects),
          now,
        );
      });
    }
  }

  private async expireRecoveryWindows(now: Date): Promise<void> {
    const rooms = await this.sql<RoomRow[]>`
      select room_id, aggregate, phase,
             recovery_started_at, recovery_expires_at,
             pause_vote_expires_at
        from ${this.sql(SCHEMA)}.rooms
       where recovery_expires_at <= ${now}
       order by recovery_expires_at
       limit 25
    `;
    for (const candidate of rooms) {
      await this.sql.begin(async (sql) => {
        const [room] = await sql<RoomRow[]>`
          select room_id, aggregate, phase,
                 recovery_started_at, recovery_expires_at,
                 pause_vote_expires_at
            from ${sql(SCHEMA)}.rooms
           where room_id = ${candidate.room_id}
             and recovery_expires_at <= ${now}
           for update skip locked
        `;
        if (room === undefined) return;
        const state = stateFrom(room.aggregate);
        if (state.phase === 'LOBBY') {
          const host = state.players.find((player) => player.isHost);
          if (host !== undefined && !host.connected) {
            await sql`
              delete from ${sql(SCHEMA)}.rooms where room_id = ${room.room_id}
            `;
          }
          return;
        }
        const transition = expirePausedGame(state, enginePorts(this.ports));
        if (transition.state === state) return;
        const next = transition.state;
        await sql`
          update ${sql(SCHEMA)}.rooms
             set state_version = ${next.stateVersion}, phase = ${next.phase},
                 aggregate = ${sql.json(next as unknown as postgres.JSONValue)},
                 recovery_started_at = null, recovery_expires_at = null,
                 pause_vote_expires_at = null,
                 last_active_at = ${now}
           where room_id = ${room.room_id}
        `;
        await this.addOutbox(
          sql,
          room.room_id,
          next.stateVersion,
          liveAudioCueId(transition.effects),
          now,
        );
      });
    }
  }

  private async addOutbox(
    sql: postgres.TransactionSql,
    roomId: string,
    stateVersion: number,
    cueId: string | null,
    now: Date,
  ): Promise<void> {
    await sql`
      insert into ${sql(SCHEMA)}.outbox
        (outbox_id, event_id, room_id, state_version, event_type,
         live_audio_cue_id, created_at, available_at)
      values
        (${this.ports.ids.next()}, ${this.ports.ids.next()}, ${roomId},
         ${stateVersion}, 'ROOM_VIEW_CHANGED', ${cueId}, ${now}, ${now})
      on conflict (room_id, state_version, event_type) do nothing
    `;
  }
}

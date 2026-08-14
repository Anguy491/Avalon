import type postgres from 'postgres';

import type { RoomViewMessage } from '@avalon/protocol';

import { projectRoom, stateFrom } from './room-service.js';
import type { RuntimePorts } from './runtime-ports.js';
import type { SessionContext } from './session-context.js';
import type { SessionPresencePort } from './session-presence.js';

const SCHEMA = 'avalon_runtime';
const CLAIM_SECONDS = 15;

interface OutboxRow {
  readonly outbox_id: string;
  readonly event_id: string;
  readonly room_id: string;
  readonly state_version: number;
  readonly event_type: string;
  readonly live_audio_cue_id: string | null;
}

interface DeliveryRow {
  readonly session_id: string;
  readonly player_id: string;
  readonly expires_at: Date;
}

interface RoomRow {
  readonly room_code: string;
  readonly aggregate: unknown;
  readonly phase: string;
  readonly state_version: number;
  readonly recovery_started_at: Date | null;
  readonly recovery_expires_at: Date | null;
}

export interface ProjectionDelivery {
  readonly sessionId: string;
  readonly playerId: string;
  readonly roomId: string;
  readonly eventId: string;
  readonly message: RoomViewMessage;
}

export interface ProjectionPublisher {
  publish(delivery: ProjectionDelivery): Promise<void>;
}

export interface OutboxWorkerOptions {
  readonly workerId: string;
  readonly batchSize?: number;
  readonly afterPublish?: () => void;
  readonly presence?: SessionPresencePort;
  readonly onTerminalCleanup?: (observation: {
    readonly trigger: 'ACK' | 'TIMEOUT' | 'NO_ONLINE_SESSIONS';
    readonly delayMs: number;
  }) => void;
  readonly onError?: (operation: 'DRAIN' | 'PUBLISH') => void;
}

export class OutboxWorker {
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<number> | undefined;
  private running = false;

  constructor(
    private readonly sql: postgres.Sql,
    private readonly publisher: ProjectionPublisher,
    private readonly ports: RuntimePorts,
    private readonly options: OutboxWorkerOptions,
  ) {}

  start(intervalMs = 50): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      if (this.inFlight !== undefined) return;
      const pending = this.drainOnce().catch(() => {
        this.options.onError?.('DRAIN');
        return 0;
      });
      this.inFlight = pending;
      void pending.finally(() => {
        if (this.inFlight === pending) this.inFlight = undefined;
      });
    }, intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  async claim(): Promise<readonly OutboxRow[]> {
    const now = this.ports.clock.now();
    const claimedUntil = new Date(now.getTime() + CLAIM_SECONDS * 1_000);
    return this.sql.begin(
      async (sql) =>
        sql<OutboxRow[]>`
        update ${sql(SCHEMA)}.outbox target
           set claimed_by = ${this.options.workerId},
               claimed_until = ${claimedUntil},
               publish_attempts = publish_attempts + 1
          from (
            select outbox_id
              from ${sql(SCHEMA)}.outbox
             where published_at is null
               and available_at <= ${now}
               and (claimed_until is null or claimed_until <= ${now})
             order by created_at, outbox_id
             for update skip locked
             limit ${this.options.batchSize ?? 25}
          ) claimable
         where target.outbox_id = claimable.outbox_id
         returning target.outbox_id, target.event_id, target.room_id,
                   target.state_version, target.event_type,
                   target.live_audio_cue_id
      `,
    );
  }

  async drainOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const rows = await this.claim();
      for (const row of rows) await this.publishRow(row);
      await this.cleanupExpiredRooms();
      return rows.length;
    } finally {
      this.running = false;
    }
  }

  private async publishRow(row: OutboxRow): Promise<void> {
    try {
      const [room] = await this.sql<RoomRow[]>`
        select room_code, aggregate, phase, state_version,
               recovery_started_at, recovery_expires_at
          from ${this.sql(SCHEMA)}.rooms
         where room_id = ${row.room_id}
      `;
      if (room === undefined) return;
      const deliveries = await this.sql<DeliveryRow[]>`
        select session_id, player_id, expires_at
         from ${this.sql(SCHEMA)}.sessions
         where room_id = ${row.room_id}
           and revoked_at is null
           and expires_at > ${this.ports.clock.now()}
         order by session_id
      `;
      const aggregateState = stateFrom(room.aggregate);
      const state: ReturnType<typeof stateFrom> = {
        ...aggregateState,
        recoveryStartedAt:
          room.recovery_started_at?.toISOString() ??
          aggregateState.recoveryStartedAt,
        recoveryExpiresAt:
          room.recovery_expires_at?.toISOString() ??
          aggregateState.recoveryExpiresAt,
      };
      let targetedDeliveries: readonly DeliveryRow[] = deliveries;
      if (room.phase === 'GAME_OVER') {
        const onlineSessionIds =
          this.options.presence === undefined
            ? deliveries.map((delivery) => delivery.session_id)
            : await this.options.presence.onlineSessionIds(row.room_id);
        const onlineSet = new Set(onlineSessionIds);
        const candidates = deliveries.filter((delivery) =>
          onlineSet.has(delivery.session_id),
        );
        const targetSessionIds = await this.sql.begin(async (sql) => {
          const [locked] = await sql<{ readonly room_id: string }[]>`
            select room_id from ${sql(SCHEMA)}.rooms
             where room_id = ${row.room_id}
             for update
          `;
          if (locked === undefined) return undefined;
          const existing = await sql<{ readonly session_id: string }[]>`
            select session_id from ${sql(SCHEMA)}.terminal_receipts
             where room_id = ${row.room_id}
             order by session_id
          `;
          if (existing.length > 0) {
            return existing.map((receipt) => receipt.session_id);
          }
          if (candidates.length === 0) {
            await sql`
              delete from ${sql(SCHEMA)}.rooms where room_id = ${row.room_id}
            `;
            return undefined;
          }
          for (const delivery of candidates) {
            await sql`
              insert into ${sql(SCHEMA)}.terminal_receipts
                (room_id, session_id, state_version)
              values
                (${row.room_id}, ${delivery.session_id}, ${room.state_version})
              on conflict do nothing
            `;
          }
          return candidates.map((delivery) => delivery.session_id);
        });
        if (targetSessionIds === undefined) {
          await this.options.presence?.clearRoom(row.room_id);
          this.options.onTerminalCleanup?.({
            trigger: 'NO_ONLINE_SESSIONS',
            delayMs: 0,
          });
          return;
        }
        const targetSet = new Set(targetSessionIds);
        targetedDeliveries = deliveries.filter((delivery) =>
          targetSet.has(delivery.session_id),
        );
      }

      for (const delivery of targetedDeliveries) {
        const message: RoomViewMessage = {
          protocolVersion: 1,
          delivery: 'LIVE',
          eventId: row.event_id,
          roomView: projectRoom(
            row.room_id,
            room.room_code,
            state,
            delivery.player_id,
            delivery.expires_at,
            {
              delivery: 'LIVE',
              liveAudioCueId: row.live_audio_cue_id,
            },
          ),
        };
        await this.publisher.publish({
          sessionId: delivery.session_id,
          playerId: delivery.player_id,
          roomId: row.room_id,
          eventId: row.event_id,
          message,
        });
      }
      this.options.afterPublish?.();

      const now = this.ports.clock.now();
      await this.sql.begin(async (sql) => {
        await sql`
          update ${sql(SCHEMA)}.outbox
             set published_at = ${now}, claimed_by = null, claimed_until = null
           where outbox_id = ${row.outbox_id}
             and claimed_by = ${this.options.workerId}
        `;
        if (room.phase === 'GAME_OVER') {
          const cleanupAfter = new Date(now.getTime() + 60_000);
          await sql`
            update ${sql(SCHEMA)}.rooms
               set terminal_published_at = coalesce(terminal_published_at, ${now}),
                   cleanup_after = coalesce(cleanup_after, ${cleanupAfter})
             where room_id = ${row.room_id}
          `;
        }
      });
    } catch {
      this.options.onError?.('PUBLISH');
      const retryAt = new Date(this.ports.clock.now().getTime() + 250);
      await this.sql`
        update ${this.sql(SCHEMA)}.outbox
           set claimed_by = null, claimed_until = null, available_at = ${retryAt}
         where outbox_id = ${row.outbox_id}
           and claimed_by = ${this.options.workerId}
      `;
    }
  }

  async acknowledgeTerminal(
    context: SessionContext,
    stateVersion: number,
  ): Promise<boolean> {
    const result = await this.sql.begin(async (sql) => {
      const [room] = await sql<
        {
          readonly room_id: string;
          readonly terminal_published_at: Date | null;
        }[]
      >`
        select room_id, terminal_published_at from ${sql(SCHEMA)}.rooms
         where room_id = ${context.roomId}
         for update
      `;
      if (room === undefined) {
        return { accepted: false, deleted: false, delayMs: 0 };
      }
      const updated = await sql<{ readonly room_id: string }[]>`
        update ${sql(SCHEMA)}.terminal_receipts
           set acknowledged_at = ${this.ports.clock.now()}
         where room_id = ${context.roomId}
           and session_id = ${context.sessionId}
           and state_version = ${stateVersion}
           and acknowledged_at is null
         returning room_id
      `;
      if (updated.length === 0) {
        return { accepted: false, deleted: false, delayMs: 0 };
      }
      const [pending] = await sql<{ readonly count: number }[]>`
        select count(*)::integer as count
          from ${sql(SCHEMA)}.terminal_receipts
         where room_id = ${context.roomId} and acknowledged_at is null
      `;
      if (pending?.count === 0) {
        await sql`
          delete from ${sql(SCHEMA)}.rooms where room_id = ${context.roomId}
        `;
        return {
          accepted: true,
          deleted: true,
          delayMs:
            room.terminal_published_at === null
              ? 0
              : Math.max(
                  0,
                  this.ports.clock.now().getTime() -
                    room.terminal_published_at.getTime(),
                ),
        };
      }
      return { accepted: true, deleted: false, delayMs: 0 };
    });
    if (result.deleted) {
      await this.options.presence?.clearRoom(context.roomId);
      this.options.onTerminalCleanup?.({
        trigger: 'ACK',
        delayMs: result.delayMs,
      });
    }
    return result.accepted;
  }

  async cleanupExpiredRooms(): Promise<number> {
    const deleted = await this.sql<
      {
        readonly room_id: string;
        readonly terminal_published_at: Date | null;
      }[]
    >`
      delete from ${this.sql(SCHEMA)}.rooms
       where cleanup_after is not null
         and cleanup_after <= ${this.ports.clock.now()}
      returning room_id, terminal_published_at
    `;
    const presence = this.options.presence;
    if (presence !== undefined) {
      await Promise.all(
        deleted.map((room) => presence.clearRoom(room.room_id)),
      );
    }
    for (const room of deleted) {
      this.options.onTerminalCleanup?.({
        trigger: 'TIMEOUT',
        delayMs:
          room.terminal_published_at === null
            ? 0
            : Math.max(
                0,
                this.ports.clock.now().getTime() -
                  room.terminal_published_at.getTime(),
              ),
      });
    }
    return deleted.length;
  }
}

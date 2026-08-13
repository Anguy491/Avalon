import type postgres from 'postgres';

import type { RoomViewMessage } from '@avalon/protocol';

import { projectRoom, stateFrom } from './room-service.js';
import type { RuntimePorts } from './runtime-ports.js';
import type { SessionContext } from './session-context.js';

const SCHEMA = 'avalon_runtime';
const CLAIM_SECONDS = 15;

interface OutboxRow {
  readonly outbox_id: string;
  readonly event_id: string;
  readonly room_id: string;
  readonly state_version: number;
  readonly event_type: string;
}

interface DeliveryRow {
  readonly session_id: string;
  readonly player_id: string;
  readonly expires_at: Date;
  readonly room_code: string;
  readonly aggregate: unknown;
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
      const pending = this.drainOnce().catch(() => 0);
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
                   target.state_version, target.event_type
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
      const deliveries = await this.sql<DeliveryRow[]>`
        select s.session_id, s.player_id, s.expires_at,
               r.room_code, r.aggregate
          from ${this.sql(SCHEMA)}.rooms r
          join ${this.sql(SCHEMA)}.sessions s on s.room_id = r.room_id
         where r.room_id = ${row.room_id}
           and s.revoked_at is null
           and s.expires_at > ${this.ports.clock.now()}
         order by s.session_id
      `;
      for (const delivery of deliveries) {
        const state = stateFrom(delivery.aggregate);
        const message: RoomViewMessage = {
          protocolVersion: 1,
          delivery: 'LIVE',
          eventId: row.event_id,
          roomView: projectRoom(
            row.room_id,
            delivery.room_code,
            state,
            delivery.player_id,
            delivery.expires_at,
            'LIVE',
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
        const [room] = await sql<
          { readonly phase: string; readonly state_version: number }[]
        >`
          select phase, state_version from ${sql(SCHEMA)}.rooms
           where room_id = ${row.room_id}
        `;
        if (room?.phase === 'GAME_OVER') {
          const cleanupAfter = new Date(now.getTime() + 60_000);
          await sql`
            update ${sql(SCHEMA)}.rooms
               set terminal_published_at = coalesce(terminal_published_at, ${now}),
                   cleanup_after = coalesce(cleanup_after, ${cleanupAfter})
             where room_id = ${row.room_id}
          `;
          await sql`
            insert into ${sql(SCHEMA)}.terminal_receipts
              (room_id, session_id, state_version)
            select ${row.room_id}, session_id, ${room.state_version}
              from ${sql(SCHEMA)}.sessions
             where room_id = ${row.room_id} and revoked_at is null
            on conflict do nothing
          `;
        }
      });
    } catch {
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
    return this.sql.begin(async (sql) => {
      const updated = await sql<{ readonly room_id: string }[]>`
        update ${sql(SCHEMA)}.terminal_receipts
           set acknowledged_at = ${this.ports.clock.now()}
         where room_id = ${context.roomId}
           and session_id = ${context.sessionId}
           and state_version = ${stateVersion}
           and acknowledged_at is null
         returning room_id
      `;
      if (updated.length === 0) return false;
      const [pending] = await sql<{ readonly count: number }[]>`
        select count(*)::integer as count
          from ${sql(SCHEMA)}.terminal_receipts
         where room_id = ${context.roomId} and acknowledged_at is null
      `;
      if (pending?.count === 0) {
        await sql`
          delete from ${sql(SCHEMA)}.rooms where room_id = ${context.roomId}
        `;
      }
      return true;
    });
  }

  async cleanupExpiredRooms(): Promise<number> {
    const deleted = await this.sql<{ readonly room_id: string }[]>`
      delete from ${this.sql(SCHEMA)}.rooms
       where cleanup_after is not null
         and cleanup_after <= ${this.ports.clock.now()}
      returning room_id
    `;
    return deleted.length;
  }
}

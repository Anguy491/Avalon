import type { RedisClientType } from 'redis';

import type { SessionContext } from './session-context.js';

const LEASE_TTL_SECONDS = 120;
const ROOM_SET_TTL_SECONDS = 120;
export const HEARTBEAT_TIMEOUT_MS = 10_000;

interface StoredLease {
  readonly leaseId: string;
  readonly sessionId: string;
  readonly roomId: string;
  readonly playerId: string;
  readonly deadlineMs: number;
  readonly issuedAtMs: number;
}

export interface ExpiredSessionLease {
  readonly sessionId: string;
  readonly roomId: string;
  readonly playerId: string;
}

function leaseKey(sessionId: string): string {
  return `avalon:session-presence:${sessionId}`;
}

function roomKey(roomId: string): string {
  return `avalon:room-presence:${roomId}`;
}

const deadlineKey = 'avalon:session-presence-deadlines';

export interface SessionPresencePort {
  markOnline(
    context: SessionContext,
    leaseId?: string,
    now?: Date,
  ): Promise<unknown>;
  refresh(
    context: SessionContext,
    leaseId?: string,
    now?: Date,
  ): Promise<unknown>;
  markOffline(context: SessionContext, leaseId?: string): Promise<void>;
  onlineSessionIds(roomId: string): Promise<readonly string[]>;
  clearRoom(roomId: string): Promise<void>;
  hasActiveSession?(sessionId: string): Promise<boolean>;
  claimExpired?(now: Date): Promise<readonly ExpiredSessionLease[]>;
}

function decodeLease(value: string | null): StoredLease | undefined {
  if (value === null) return undefined;
  try {
    const decoded = JSON.parse(value) as Partial<StoredLease>;
    if (
      typeof decoded.leaseId !== 'string' ||
      typeof decoded.sessionId !== 'string' ||
      typeof decoded.roomId !== 'string' ||
      typeof decoded.playerId !== 'string' ||
      typeof decoded.deadlineMs !== 'number' ||
      typeof decoded.issuedAtMs !== 'number'
    ) {
      return undefined;
    }
    return decoded as StoredLease;
  } catch {
    return undefined;
  }
}

export class RedisSessionPresence implements SessionPresencePort {
  constructor(private readonly redis: RedisClientType) {}

  private async ensureConnected(): Promise<void> {
    if (!this.redis.isOpen) await this.redis.connect();
  }

  async markOnline(
    context: SessionContext,
    leaseId = context.sessionId,
    now = new Date(),
  ): Promise<boolean> {
    await this.ensureConnected();
    const lease: StoredLease = {
      leaseId,
      sessionId: context.sessionId,
      roomId: context.roomId,
      playerId: context.playerId,
      deadlineMs: now.getTime() + HEARTBEAT_TIMEOUT_MS,
      issuedAtMs: now.getTime(),
    };
    const accepted = await this.redis.eval(
      "local current = redis.call('GET', KEYS[1]); if current then local decoded = cjson.decode(current); if decoded.issuedAtMs > tonumber(ARGV[1]) then return 0 end end; redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]); redis.call('SADD', KEYS[2], ARGV[4]); redis.call('EXPIRE', KEYS[2], ARGV[5]); redis.call('ZADD', KEYS[3], ARGV[6], ARGV[4]); return 1",
      {
        keys: [
          leaseKey(context.sessionId),
          roomKey(context.roomId),
          deadlineKey,
        ],
        arguments: [
          String(lease.issuedAtMs),
          JSON.stringify(lease),
          String(LEASE_TTL_SECONDS),
          context.sessionId,
          String(ROOM_SET_TTL_SECONDS),
          String(lease.deadlineMs),
        ],
      },
    );
    return accepted === 1;
  }

  async refresh(
    context: SessionContext,
    leaseId = context.sessionId,
    now = new Date(),
  ): Promise<boolean> {
    await this.ensureConnected();
    const key = leaseKey(context.sessionId);
    const current = decodeLease(await this.redis.get(key));
    if (current?.leaseId !== leaseId) return false;
    const next: StoredLease = {
      ...current,
      deadlineMs: now.getTime() + HEARTBEAT_TIMEOUT_MS,
    };
    const refreshed = await this.redis.eval(
      "local current = redis.call('GET', KEYS[1]); if not current then return 0 end; local decoded = cjson.decode(current); if decoded.leaseId ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]); redis.call('SADD', KEYS[2], ARGV[4]); redis.call('EXPIRE', KEYS[2], ARGV[5]); redis.call('ZADD', KEYS[3], ARGV[6], ARGV[4]); return 1",
      {
        keys: [key, roomKey(context.roomId), deadlineKey],
        arguments: [
          leaseId,
          JSON.stringify(next),
          String(LEASE_TTL_SECONDS),
          context.sessionId,
          String(ROOM_SET_TTL_SECONDS),
          String(next.deadlineMs),
        ],
      },
    );
    return refreshed === 1;
  }

  async markOffline(
    context: SessionContext,
    leaseId = context.sessionId,
  ): Promise<void> {
    await this.ensureConnected();
    const key = leaseKey(context.sessionId);
    const raw = await this.redis.get(key);
    const current = decodeLease(raw);
    if (current?.leaseId !== leaseId) return;
    if (raw === null) return;
    await this.redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]); redis.call('SREM', KEYS[2], ARGV[2]); redis.call('ZREM', KEYS[3], ARGV[2]); return 1 else return 0 end",
      {
        keys: [key, roomKey(context.roomId), deadlineKey],
        arguments: [raw, context.sessionId],
      },
    );
  }

  async claimExpired(now: Date): Promise<readonly ExpiredSessionLease[]> {
    await this.ensureConnected();
    const sessionIds = await this.redis.zRangeByScore(
      deadlineKey,
      0,
      now.getTime(),
    );
    const expired: ExpiredSessionLease[] = [];
    for (const sessionId of sessionIds) {
      const key = leaseKey(sessionId);
      const raw = await this.redis.get(key);
      const lease = decodeLease(raw);
      if (raw === null || lease === undefined) {
        await this.redis.zRem(deadlineKey, sessionId);
        continue;
      }
      if (lease.deadlineMs > now.getTime()) continue;
      const claimed = await this.redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]); redis.call('ZREM', KEYS[2], ARGV[2]); redis.call('SREM', KEYS[3], ARGV[2]); return 1 else return 0 end",
        {
          keys: [key, deadlineKey, roomKey(lease.roomId)],
          arguments: [raw, sessionId],
        },
      );
      if (claimed === 1) {
        expired.push({
          sessionId,
          roomId: lease.roomId,
          playerId: lease.playerId,
        });
      }
    }
    return expired;
  }

  async onlineSessionIds(roomId: string): Promise<readonly string[]> {
    await this.ensureConnected();
    const members = await this.redis.sMembers(roomKey(roomId));
    if (members.length === 0) return [];
    const leases = await this.redis.mGet(members.map(leaseKey));
    const online: string[] = [];
    const stale: string[] = [];
    for (const [index, sessionId] of members.entries()) {
      const lease = decodeLease(leases[index] ?? null);
      if (lease?.roomId === roomId) online.push(sessionId);
      else stale.push(sessionId);
    }
    if (stale.length > 0) await this.redis.sRem(roomKey(roomId), stale);
    return online;
  }

  async hasActiveSession(sessionId: string): Promise<boolean> {
    await this.ensureConnected();
    return decodeLease(await this.redis.get(leaseKey(sessionId))) !== undefined;
  }

  async clearRoom(roomId: string): Promise<void> {
    await this.ensureConnected();
    const key = roomKey(roomId);
    const members = await this.redis.sMembers(key);
    const transaction = this.redis.multi().del(key);
    for (const sessionId of members) {
      transaction.del(leaseKey(sessionId)).zRem(deadlineKey, sessionId);
    }
    await transaction.exec();
  }
}

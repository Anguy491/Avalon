import type { RedisClientType } from 'redis';

import type { SessionContext } from './session-context.js';

const PRESENCE_TTL_SECONDS = 15;
const ROOM_SET_TTL_SECONDS = 120;

function leaseKey(sessionId: string): string {
  return `avalon:session-presence:${sessionId}`;
}

function roomKey(roomId: string): string {
  return `avalon:room-presence:${roomId}`;
}

export interface SessionPresencePort {
  markOnline(context: SessionContext): Promise<void>;
  refresh(context: SessionContext): Promise<void>;
  markOffline(context: SessionContext): Promise<void>;
  onlineSessionIds(roomId: string): Promise<readonly string[]>;
  clearRoom(roomId: string): Promise<void>;
}

export class RedisSessionPresence implements SessionPresencePort {
  constructor(private readonly redis: RedisClientType) {}

  private async ensureConnected(): Promise<void> {
    if (!this.redis.isOpen) await this.redis.connect();
  }

  async markOnline(context: SessionContext): Promise<void> {
    await this.ensureConnected();
    await this.redis
      .multi()
      .set(leaseKey(context.sessionId), context.roomId, {
        expiration: { type: 'EX', value: PRESENCE_TTL_SECONDS },
      })
      .sAdd(roomKey(context.roomId), context.sessionId)
      .expire(roomKey(context.roomId), ROOM_SET_TTL_SECONDS)
      .exec();
  }

  refresh(context: SessionContext): Promise<void> {
    return this.markOnline(context);
  }

  async markOffline(context: SessionContext): Promise<void> {
    await this.ensureConnected();
    await this.redis
      .multi()
      .del(leaseKey(context.sessionId))
      .sRem(roomKey(context.roomId), context.sessionId)
      .exec();
  }

  async onlineSessionIds(roomId: string): Promise<readonly string[]> {
    await this.ensureConnected();
    const members = await this.redis.sMembers(roomKey(roomId));
    if (members.length === 0) return [];
    const leases = await this.redis.mGet(members.map(leaseKey));
    const online: string[] = [];
    const stale: string[] = [];
    for (const [index, sessionId] of members.entries()) {
      if (leases[index] === roomId) online.push(sessionId);
      else stale.push(sessionId);
    }
    if (stale.length > 0) {
      await this.redis.sRem(roomKey(roomId), stale);
    }
    return online;
  }

  async clearRoom(roomId: string): Promise<void> {
    await this.ensureConnected();
    const key = roomKey(roomId);
    const members = await this.redis.sMembers(key);
    const keys = [key, ...members.map(leaseKey)];
    if (keys.length > 0) await this.redis.del(keys);
  }
}

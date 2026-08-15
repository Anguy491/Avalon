import { createHmac } from 'node:crypto';

import type { RedisClientType } from 'redis';

import type { ServerConfig } from './config.js';
import { withinFixedWindow } from './redis-rate-limit.js';

const ACTIVE_SOCKET_TTL_MS = 15_000;

export class RealtimeAdmission {
  private pendingAuthentication = 0;

  constructor(
    private readonly redis: RedisClientType,
    private readonly config: ServerConfig,
    private readonly instanceId: string,
  ) {}

  async allowEngineHandshake(clientIp: string, now: Date): Promise<boolean> {
    const ipKey = createHmac('sha256', this.config.rateLimitHmacSecret)
      .update(clientIp)
      .digest('base64url');
    return withinFixedWindow(
      this.redis,
      `avalon:handshake-rate:${ipKey}`,
      this.config.handshakeIpRateLimit,
      now,
    );
  }

  async hasGlobalCapacity(now: Date): Promise<boolean> {
    if (!this.redis.isOpen) await this.redis.connect();
    await this.redis.zRemRangeByScore(
      'avalon:active-sockets',
      0,
      now.getTime(),
    );
    return (
      (await this.redis.zCard('avalon:active-sockets')) <
      this.config.globalConnectionLimit
    );
  }

  async authenticateWithinBudget<T>(operation: () => Promise<T>): Promise<T> {
    if (this.pendingAuthentication >= this.config.pendingAuthLimit) {
      throw new Error('AUTH_CAPACITY');
    }
    this.pendingAuthentication += 1;
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(new Error('AUTH_TIMEOUT'));
          }, this.config.authTimeoutMs);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      this.pendingAuthentication -= 1;
    }
  }

  async reserve(
    sessionId: string,
    socketId: string,
    now: Date,
  ): Promise<boolean> {
    if (!this.redis.isOpen) await this.redis.connect();
    const member = `${this.instanceId}:${socketId}`;
    const deadline = now.getTime() + ACTIVE_SOCKET_TTL_MS;
    const result = await this.redis.eval(
      "redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1]); redis.call('ZREMRANGEBYSCORE', KEYS[2], 0, ARGV[1]); if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end; if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[3]) then return 0 end; redis.call('ZADD', KEYS[1], ARGV[4], ARGV[5]); redis.call('ZADD', KEYS[2], ARGV[4], ARGV[5]); redis.call('PEXPIRE', KEYS[1], ARGV[6]); redis.call('PEXPIRE', KEYS[2], ARGV[6]); return 1",
      {
        keys: [
          'avalon:active-sockets',
          `avalon:active-session-sockets:${sessionId}`,
        ],
        arguments: [
          String(now.getTime()),
          String(this.config.globalConnectionLimit),
          String(this.config.sessionSocketLimit),
          String(deadline),
          member,
          String(ACTIVE_SOCKET_TTL_MS * 2),
        ],
      },
    );
    return result === 1;
  }

  async refresh(sessionId: string, socketId: string, now: Date): Promise<void> {
    if (!this.redis.isOpen) return;
    const member = `${this.instanceId}:${socketId}`;
    const deadline = now.getTime() + ACTIVE_SOCKET_TTL_MS;
    await this.redis
      .multi()
      .zAdd('avalon:active-sockets', { score: deadline, value: member })
      .zAdd(`avalon:active-session-sockets:${sessionId}`, {
        score: deadline,
        value: member,
      })
      .exec();
  }

  async release(sessionId: string, socketId: string): Promise<void> {
    if (!this.redis.isOpen) return;
    const member = `${this.instanceId}:${socketId}`;
    await this.redis
      .multi()
      .zRem('avalon:active-sockets', member)
      .zRem(`avalon:active-session-sockets:${sessionId}`, member)
      .exec();
  }
}

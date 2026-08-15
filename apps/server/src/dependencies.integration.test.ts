import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDependencyChecks,
  type RuntimeDependencies,
} from './dependencies.js';
import { RedisSessionPresence } from './session-presence.js';

describe('M0-006 PostgreSQL and Redis test containers', () => {
  let dependencies: RuntimeDependencies | undefined;
  let stopContainers: (() => Promise<void>) | undefined;
  let interruptPostgres: (() => Promise<void>) | undefined;
  let interruptRedis: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const [postgresContainer, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:18.1-alpine3.22').start(),
      new RedisContainer('redis:8.2.3-alpine3.22').start(),
    ]);
    dependencies = createDependencyChecks({
      databaseUrl: postgresContainer.getConnectionUri(),
      redisUrl: redisContainer.getConnectionUrl(),
      databasePoolMax: 10,
      databaseQueryTimeoutMs: 2_000,
    });
    stopContainers = async () => {
      await Promise.all([postgresContainer.stop(), redisContainer.stop()]);
    };
    interruptPostgres = async () => {
      const result = await postgresContainer.exec([
        'psql',
        '-U',
        postgresContainer.getUsername(),
        '-d',
        postgresContainer.getDatabase(),
        '-c',
        'select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()',
      ]);
      if (result.exitCode !== 0) {
        throw new Error('Could not interrupt PostgreSQL client connections');
      }
    };
    interruptRedis = async () => {
      const result = await redisContainer.exec([
        'redis-cli',
        'CLIENT',
        'KILL',
        'TYPE',
        'normal',
        'SKIPME',
        'yes',
      ]);
      if (result.exitCode !== 0) {
        throw new Error('Could not interrupt Redis client connections');
      }
    };
  });

  afterAll(async () => {
    await dependencies?.close();
    await stopContainers?.();
  });

  it('connects to real PostgreSQL and Redis dependencies', async () => {
    if (dependencies === undefined) {
      throw new Error('Integration dependencies not started');
    }
    await expect(dependencies.checkPostgres()).resolves.toBeUndefined();
    await expect(dependencies.checkRedis()).resolves.toBeUndefined();
  });

  it('M5-004 tracks and clears terminal delivery presence without raw tokens', async () => {
    if (dependencies === undefined) {
      throw new Error('Integration dependencies not started');
    }
    const presence = new RedisSessionPresence(dependencies.redis);
    const context = {
      sessionId: '10000000-0000-4000-8000-000000000001',
      tokenFamily: '10000000-0000-4000-8000-000000000002',
      roomId: '10000000-0000-4000-8000-000000000003',
      playerId: '10000000-0000-4000-8000-000000000004',
      tokenDigest: 'digest-only',
      credentialGeneration: 1,
      expiresAt: new Date('2026-08-14T12:00:00.000Z'),
    };
    await presence.markOnline(context);
    await expect(presence.onlineSessionIds(context.roomId)).resolves.toEqual([
      context.sessionId,
    ]);
    await presence.markOffline(context);
    await expect(presence.onlineSessionIds(context.roomId)).resolves.toEqual(
      [],
    );
    await presence.markOnline(context);
    await presence.refresh(context);
    await presence.clearRoom(context.roomId);
    await expect(presence.onlineSessionIds(context.roomId)).resolves.toEqual(
      [],
    );
  });

  it('SM-003/SM-020 keeps the newest socket lease and claims the 10 second boundary once', async () => {
    if (dependencies === undefined) {
      throw new Error('Integration dependencies not started');
    }
    const presence = new RedisSessionPresence(dependencies.redis);
    const context = {
      sessionId: '20000000-0000-4000-8000-000000000001',
      tokenFamily: '20000000-0000-4000-8000-000000000002',
      roomId: '20000000-0000-4000-8000-000000000003',
      playerId: '20000000-0000-4000-8000-000000000004',
      tokenDigest: 'digest-only',
      credentialGeneration: 1,
      expiresAt: new Date('2026-08-14T12:30:00.000Z'),
    };
    const connectedAt = new Date('2026-08-14T12:00:00.000Z');
    await presence.markOnline(context, 'old-socket', connectedAt);
    await presence.markOnline(
      context,
      'new-socket',
      new Date(connectedAt.getTime() + 1),
    );
    await expect(
      presence.refresh(
        context,
        'old-socket',
        new Date(connectedAt.getTime() + 5_000),
      ),
    ).resolves.toBe(false);
    await presence.markOffline(context, 'old-socket');
    await expect(presence.onlineSessionIds(context.roomId)).resolves.toEqual([
      context.sessionId,
    ]);
    await expect(
      presence.claimExpired(new Date(connectedAt.getTime() + 10_000)),
    ).resolves.toEqual([]);
    await expect(
      presence.claimExpired(new Date(connectedAt.getTime() + 10_001)),
    ).resolves.toEqual([
      {
        sessionId: context.sessionId,
        roomId: context.roomId,
        playerId: context.playerId,
      },
    ]);
    await expect(
      presence.claimExpired(new Date(connectedAt.getTime() + 20_000)),
    ).resolves.toEqual([]);
  });

  it('SM-020 restores the current socket lease after Redis state is cleared', async () => {
    if (dependencies === undefined) {
      throw new Error('Integration dependencies not started');
    }
    const presence = new RedisSessionPresence(dependencies.redis);
    const context = {
      sessionId: '30000000-0000-4000-8000-000000000001',
      tokenFamily: '30000000-0000-4000-8000-000000000002',
      roomId: '30000000-0000-4000-8000-000000000003',
      playerId: '30000000-0000-4000-8000-000000000004',
      tokenDigest: 'digest-only',
      credentialGeneration: 1,
      expiresAt: new Date('2026-08-14T12:30:00.000Z'),
    };
    const connectedAt = new Date('2026-08-14T12:00:00.000Z');
    await expect(
      presence.markOnline(context, 'current-socket', connectedAt),
    ).resolves.toBe(true);
    await presence.clearRoom(context.roomId);
    await expect(
      presence.refresh(
        context,
        'current-socket',
        new Date(connectedAt.getTime() + 2_000),
      ),
    ).resolves.toBe(false);
    await expect(
      presence.markOnline(context, 'current-socket', connectedAt),
    ).resolves.toBe(true);
    await expect(presence.onlineSessionIds(context.roomId)).resolves.toEqual([
      context.sessionId,
    ]);
  });

  it('M7-005 recovers dependency health within five seconds after PostgreSQL and Redis connection loss', async () => {
    if (
      dependencies === undefined ||
      interruptPostgres === undefined ||
      interruptRedis === undefined
    ) {
      throw new Error('Integration dependencies not started');
    }
    const runtime = dependencies;
    const waitForHealth = async (check: () => Promise<void>) => {
      const started = performance.now();
      let lastError: unknown;
      while (performance.now() - started < 5_000) {
        try {
          await check();
          return performance.now() - started;
        } catch (error) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      throw lastError;
    };

    await interruptPostgres();
    await expect(
      waitForHealth(() => runtime.checkPostgres()),
    ).resolves.toBeLessThan(5_000);

    await interruptRedis();
    await expect(
      waitForHealth(() => runtime.checkRedis()),
    ).resolves.toBeLessThan(5_000);
  }, 20_000);
});

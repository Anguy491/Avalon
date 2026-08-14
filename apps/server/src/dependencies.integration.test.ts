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

  beforeAll(async () => {
    const [postgresContainer, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:18.1-alpine3.22').start(),
      new RedisContainer('redis:8.2.3-alpine3.22').start(),
    ]);
    dependencies = createDependencyChecks({
      databaseUrl: postgresContainer.getConnectionUri(),
      redisUrl: redisContainer.getConnectionUrl(),
    });
    stopContainers = async () => {
      await Promise.all([postgresContainer.stop(), redisContainer.stop()]);
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
});

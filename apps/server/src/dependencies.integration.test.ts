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
});

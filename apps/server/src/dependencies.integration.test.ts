import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDependencyChecks,
  type DependencyChecks,
} from './dependencies.js';

describe('M0-006 PostgreSQL and Redis test containers', () => {
  let dependencies: DependencyChecks | undefined;
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
});

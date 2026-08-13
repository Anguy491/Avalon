import postgres from 'postgres';
import { createClient, type RedisClientType } from 'redis';

import type { ServerConfig } from './config.js';

export interface DependencyChecks {
  checkPostgres(): Promise<void>;
  checkRedis(): Promise<void>;
  close(): Promise<void>;
}

const DEPENDENCY_TIMEOUT_MS = 5_000;

async function withTimeout<T>(
  operation: Promise<T>,
  dependency: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${dependency} readiness timed out`));
        }, DEPENDENCY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function createDependencyChecks(
  config: Pick<ServerConfig, 'databaseUrl' | 'redisUrl'>,
): DependencyChecks {
  const sql = postgres(config.databaseUrl, {
    connect_timeout: DEPENDENCY_TIMEOUT_MS / 1_000,
    max: 2,
    onnotice: () => undefined,
  });
  const redis: RedisClientType = createClient({
    url: config.redisUrl,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: DEPENDENCY_TIMEOUT_MS,
      reconnectStrategy: false,
    },
  });

  return {
    async checkPostgres() {
      await withTimeout(sql`select 1 as healthy`, 'PostgreSQL');
    },
    async checkRedis() {
      if (!redis.isOpen) await withTimeout(redis.connect(), 'Redis');
      await withTimeout(redis.ping(), 'Redis');
    },
    async close() {
      await Promise.all([
        sql.end({ timeout: 2 }),
        redis.isOpen ? redis.quit() : Promise.resolve(),
      ]);
    },
  };
}

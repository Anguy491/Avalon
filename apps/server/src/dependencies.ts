import postgres from 'postgres';
import { createClient, type RedisClientType } from 'redis';

import type { ServerConfig } from './config.js';

export interface DependencyChecks {
  checkPostgres(): Promise<void>;
  checkRedis(): Promise<void>;
  close(): Promise<void>;
}

export interface RuntimeDependencies extends DependencyChecks {
  readonly sql: postgres.Sql;
  readonly redis: RedisClientType;
}

const DEPENDENCY_TIMEOUT_MS = 5_000;
const READINESS_ATTEMPT_TIMEOUT_MS = 1_000;

async function withTimeout<T>(
  operation: Promise<T>,
  dependency: string,
  timeoutMs = DEPENDENCY_TIMEOUT_MS,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${dependency} readiness timed out`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function createDependencyChecks(
  config: Pick<
    ServerConfig,
    'databaseUrl' | 'redisUrl' | 'databasePoolMax' | 'databaseQueryTimeoutMs'
  >,
): RuntimeDependencies {
  const createSql = () =>
    postgres(config.databaseUrl, {
      max: config.databasePoolMax,
      max_lifetime: 60 * 30,
      idle_timeout: 20,
      connect_timeout: Math.ceil(config.databaseQueryTimeoutMs / 1_000),
      connection: { statement_timeout: config.databaseQueryTimeoutMs },
      onnotice: () => undefined,
    });
  let activeSql = createSql();
  const sql = new Proxy(activeSql, {
    apply(_target, thisArgument, argumentsList) {
      const result: unknown = Reflect.apply(
        activeSql,
        thisArgument,
        argumentsList,
      );
      return result;
    },
    get(_target, property) {
      const value: unknown = Reflect.get(activeSql, property, activeSql);
      return value;
    },
  });
  let sqlRecovery: Promise<void> | undefined;
  const recoverSql = async () => {
    if (sqlRecovery !== undefined) return sqlRecovery;
    const previous = activeSql;
    activeSql = createSql();
    sqlRecovery = previous
      .end({ timeout: 0 })
      .catch(() => undefined)
      .then(() => undefined)
      .finally(() => {
        sqlRecovery = undefined;
      });
    return sqlRecovery;
  };
  const redis: RedisClientType = createClient({
    url: config.redisUrl,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: DEPENDENCY_TIMEOUT_MS,
      reconnectStrategy: (retries) =>
        Math.min(50 * 2 ** Math.min(retries, 5), 1_000),
    },
  });
  // node-redis emits transport failures as events. Recovery is handled by its
  // bounded reconnect strategy and readiness stays fail-closed meanwhile.
  redis.on('error', () => undefined);

  return {
    sql,
    redis,
    async checkPostgres() {
      try {
        await withTimeout(
          sql`select 1 as healthy`,
          'PostgreSQL',
          READINESS_ATTEMPT_TIMEOUT_MS,
        );
      } catch {
        await recoverSql();
        await withTimeout(
          sql`select 1 as healthy`,
          'PostgreSQL',
          READINESS_ATTEMPT_TIMEOUT_MS,
        );
      }
    },
    async checkRedis() {
      if (!redis.isOpen) {
        await withTimeout(
          redis.connect(),
          'Redis',
          READINESS_ATTEMPT_TIMEOUT_MS,
        );
      }
      await withTimeout(redis.ping(), 'Redis', READINESS_ATTEMPT_TIMEOUT_MS);
    },
    async close() {
      await Promise.all([
        activeSql.end({ timeout: 2 }),
        redis.isReady
          ? redis.quit()
          : Promise.resolve().then(() => {
              if (redis.isOpen) redis.destroy();
            }),
      ]);
    },
  };
}

export function isRuntimeDependencies(
  dependencies: DependencyChecks,
): dependencies is RuntimeDependencies {
  return 'sql' in dependencies && 'redis' in dependencies;
}

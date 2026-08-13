import type { FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import type { RedisClientType } from 'redis';

import type { ClockPort } from './runtime-ports.js';

interface StoreCallback {
  (
    error: Error | null,
    result?: { readonly current: number; readonly ttl: number },
  ): void;
}

interface RouteStoreOptions {
  readonly routeInfo?: {
    readonly method?: string | readonly string[];
    readonly url?: string;
  };
}

function routeNamespace(value: unknown): string {
  if (typeof value !== 'object' || value === null) return 'route:';
  const route = value as RouteStoreOptions;
  const rawMethod = route.routeInfo?.method;
  let method = 'UNKNOWN';
  if (typeof rawMethod === 'string') method = rawMethod;
  if (Array.isArray(rawMethod)) method = rawMethod.join(',');
  return `${method}:${route.routeInfo?.url ?? 'unknown'}:`;
}

export function createRedisRateLimitStore(
  redis: RedisClientType,
  clock: ClockPort,
): FastifyRateLimitStoreCtor {
  return class RedisRateLimitStore {
    private namespace = 'avalon:rate:';

    child(options: unknown): RedisRateLimitStore {
      const child = new RedisRateLimitStore();
      child.namespace = `${this.namespace}${routeNamespace(options)}`;
      return child;
    }

    incr(digest: string, callback: StoreCallback, timeWindow: number): void {
      const bucket = Math.floor(clock.now().getTime() / timeWindow);
      const key = `${this.namespace}${digest}:${String(bucket)}`;
      void (async () => {
        try {
          if (!redis.isOpen) await redis.connect();
          const result = await redis
            .multi()
            .incr(key)
            .pExpire(key, timeWindow)
            .exec();
          callback(null, { current: Number(result[0]), ttl: timeWindow });
        } catch (error) {
          callback(
            error instanceof Error
              ? error
              : new Error('Redis rate limiter failed'),
          );
        }
      })();
    }
  };
}

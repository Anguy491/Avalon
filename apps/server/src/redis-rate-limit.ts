import type { RedisClientType } from 'redis';

export async function withinFixedWindow(
  redis: RedisClientType,
  key: string,
  limit: number,
  now: Date,
  windowMs = 60_000,
): Promise<boolean> {
  if (!redis.isOpen) await redis.connect();
  const window = Math.floor(now.getTime() / windowMs);
  const bucket = `${key}:${String(window)}`;
  const results = await redis
    .multi()
    .incr(bucket)
    .pExpire(bucket, windowMs + 5_000)
    .exec();
  return Number(results[0]) <= limit;
}

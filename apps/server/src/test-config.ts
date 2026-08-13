import type { ServerConfig } from './config.js';

export const TEST_CONFIG: ServerConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'silent',
  databaseUrl: 'postgres://test.invalid/avalon',
  redisUrl: 'redis://test.invalid:6379',
  rateLimitMax: 100,
  rateLimitHmacSecret: 'm0-test-rate-limit-key-material-0001',
  joinRateLimitMax: 5,
  sessionTokenPepper: 'm2-test-session-token-pepper-material-0001',
  idempotencyEncryptionSecret: 'm2-test-idempotency-encryption-material-0001',
  sessionTtlSeconds: 1_800,
  realtimePublicUrl: 'wss://localhost.invalid/game-v1',
};

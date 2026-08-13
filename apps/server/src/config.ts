import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const CONFIG_KEYS = [
  'NODE_ENV',
  'HOST',
  'PORT',
  'LOG_LEVEL',
  'DATABASE_URL',
  'REDIS_URL',
  'RATE_LIMIT_MAX',
  'RATE_LIMIT_HMAC_SECRET',
  'JOIN_RATE_LIMIT_MAX',
  'SESSION_TOKEN_PEPPER',
  'IDEMPOTENCY_ENCRYPTION_SECRET',
  'SESSION_TTL_SECONDS',
  'REALTIME_PUBLIC_URL',
] as const;

type ConfigKey = (typeof CONFIG_KEYS)[number];

const ConfigSchema = Type.Object(
  {
    nodeEnv: Type.Union([
      Type.Literal('development'),
      Type.Literal('test'),
      Type.Literal('production'),
    ]),
    host: Type.String({ minLength: 1 }),
    port: Type.Integer({ minimum: 1, maximum: 65_535 }),
    logLevel: Type.Union([
      Type.Literal('fatal'),
      Type.Literal('error'),
      Type.Literal('warn'),
      Type.Literal('info'),
      Type.Literal('debug'),
      Type.Literal('trace'),
      Type.Literal('silent'),
    ]),
    databaseUrl: Type.String({ pattern: '^postgres(?:ql)?://' }),
    redisUrl: Type.String({ pattern: '^redis(?:s)?://' }),
    rateLimitMax: Type.Integer({ minimum: 1, maximum: 10_000 }),
    rateLimitHmacSecret: Type.String({ minLength: 32 }),
    joinRateLimitMax: Type.Integer({ minimum: 1, maximum: 100 }),
    sessionTokenPepper: Type.String({ minLength: 32 }),
    idempotencyEncryptionSecret: Type.String({ minLength: 32 }),
    sessionTtlSeconds: Type.Integer({ minimum: 60, maximum: 86_400 }),
    realtimePublicUrl: Type.String({ pattern: '^wss://' }),
  },
  { additionalProperties: false },
);

export interface ServerConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel:
    | 'fatal'
    | 'error'
    | 'warn'
    | 'info'
    | 'debug'
    | 'trace'
    | 'silent';
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly rateLimitMax: number;
  readonly rateLimitHmacSecret: string;
  readonly joinRateLimitMax: number;
  readonly sessionTokenPepper: string;
  readonly idempotencyEncryptionSecret: string;
  readonly sessionTtlSeconds: number;
  readonly realtimePublicUrl: string;
}

const read = (
  environment: NodeJS.ProcessEnv,
  key: ConfigKey,
  fallback?: string,
): string => {
  const value = environment[key] ?? fallback;
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required server configuration: ${key}`);
  }
  return value;
};

const parseInteger = (value: string, key: ConfigKey): number => {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Server configuration ${key} must be an integer`);
  }
  return Number(value);
};

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const config = {
    nodeEnv: read(environment, 'NODE_ENV', 'development'),
    host: read(environment, 'HOST', '0.0.0.0'),
    port: parseInteger(read(environment, 'PORT', '3000'), 'PORT'),
    logLevel: read(environment, 'LOG_LEVEL', 'info'),
    databaseUrl: read(environment, 'DATABASE_URL'),
    redisUrl: read(environment, 'REDIS_URL'),
    rateLimitMax: parseInteger(
      read(environment, 'RATE_LIMIT_MAX', '60'),
      'RATE_LIMIT_MAX',
    ),
    rateLimitHmacSecret: read(environment, 'RATE_LIMIT_HMAC_SECRET'),
    joinRateLimitMax: parseInteger(
      read(environment, 'JOIN_RATE_LIMIT_MAX', '5'),
      'JOIN_RATE_LIMIT_MAX',
    ),
    sessionTokenPepper: read(environment, 'SESSION_TOKEN_PEPPER'),
    idempotencyEncryptionSecret: read(
      environment,
      'IDEMPOTENCY_ENCRYPTION_SECRET',
    ),
    sessionTtlSeconds: parseInteger(
      read(environment, 'SESSION_TTL_SECONDS', '1800'),
      'SESSION_TTL_SECONDS',
    ),
    realtimePublicUrl: read(
      environment,
      'REALTIME_PUBLIC_URL',
      'wss://localhost.invalid/game-v1',
    ),
  };

  if (!Value.Check(ConfigSchema, config)) {
    const problems = [...Value.Errors(ConfigSchema, config)]
      .map((problem) => problem.path || '/')
      .join(', ');
    throw new Error(`Invalid server configuration at: ${problems}`);
  }

  return config as ServerConfig;
}

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
  'TRUSTED_PROXY_CIDRS',
  'HANDSHAKE_IP_RATE_LIMIT',
  'PENDING_AUTH_LIMIT',
  'AUTH_TIMEOUT_MS',
  'INSTANCE_CONNECTION_LIMIT',
  'GLOBAL_CONNECTION_LIMIT',
  'SESSION_SOCKET_LIMIT',
  'TERMINAL_ACK_RATE_LIMIT',
  'AUDIO_TELEMETRY_RATE_LIMIT',
  'CREATE_JOIN_IP_RATE_LIMIT',
  'CREATE_JOIN_GLOBAL_RATE_LIMIT',
  'DATABASE_POOL_MAX',
  'DATABASE_QUERY_TIMEOUT_MS',
  'OUTBOX_BATCH_SIZE',
  'OTLP_METRICS_ENDPOINT',
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
    trustedProxyCidrs: Type.Array(Type.String({ minLength: 3 }), {
      maxItems: 32,
      uniqueItems: true,
    }),
    handshakeIpRateLimit: Type.Integer({ minimum: 1, maximum: 10_000 }),
    pendingAuthLimit: Type.Integer({ minimum: 1, maximum: 10_000 }),
    authTimeoutMs: Type.Integer({ minimum: 100, maximum: 30_000 }),
    instanceConnectionLimit: Type.Integer({ minimum: 1, maximum: 100_000 }),
    globalConnectionLimit: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    sessionSocketLimit: Type.Integer({ minimum: 1, maximum: 10 }),
    terminalAckRateLimit: Type.Integer({ minimum: 1, maximum: 60 }),
    audioTelemetryRateLimit: Type.Integer({ minimum: 1, maximum: 600 }),
    createJoinIpRateLimit: Type.Integer({ minimum: 1, maximum: 10_000 }),
    createJoinGlobalRateLimit: Type.Integer({ minimum: 1, maximum: 100_000 }),
    databasePoolMax: Type.Integer({ minimum: 1, maximum: 1_000 }),
    databaseQueryTimeoutMs: Type.Integer({ minimum: 100, maximum: 60_000 }),
    outboxBatchSize: Type.Integer({ minimum: 1, maximum: 1_000 }),
    otlpMetricsEndpoint: Type.Optional(
      Type.String({ pattern: '^https?://', maxLength: 2_048 }),
    ),
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
  readonly trustedProxyCidrs: readonly string[];
  readonly handshakeIpRateLimit: number;
  readonly pendingAuthLimit: number;
  readonly authTimeoutMs: number;
  readonly instanceConnectionLimit: number;
  readonly globalConnectionLimit: number;
  readonly sessionSocketLimit: number;
  readonly terminalAckRateLimit: number;
  readonly audioTelemetryRateLimit: number;
  readonly createJoinIpRateLimit: number;
  readonly createJoinGlobalRateLimit: number;
  readonly databasePoolMax: number;
  readonly databaseQueryTimeoutMs: number;
  readonly outboxBatchSize: number;
  readonly otlpMetricsEndpoint?: string;
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
  const nodeEnv = read(environment, 'NODE_ENV', 'development');
  const trustedProxyValue = environment.TRUSTED_PROXY_CIDRS?.trim() ?? '';
  if (nodeEnv === 'production' && trustedProxyValue.length === 0) {
    throw new Error(
      'Missing required server configuration: TRUSTED_PROXY_CIDRS',
    );
  }
  const config = {
    nodeEnv,
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
    trustedProxyCidrs:
      trustedProxyValue.length === 0
        ? []
        : trustedProxyValue.split(',').map((value) => value.trim()),
    handshakeIpRateLimit: parseInteger(
      read(environment, 'HANDSHAKE_IP_RATE_LIMIT', '30'),
      'HANDSHAKE_IP_RATE_LIMIT',
    ),
    pendingAuthLimit: parseInteger(
      read(environment, 'PENDING_AUTH_LIMIT', '100'),
      'PENDING_AUTH_LIMIT',
    ),
    authTimeoutMs: parseInteger(
      read(environment, 'AUTH_TIMEOUT_MS', '3000'),
      'AUTH_TIMEOUT_MS',
    ),
    instanceConnectionLimit: parseInteger(
      read(environment, 'INSTANCE_CONNECTION_LIMIT', '6000'),
      'INSTANCE_CONNECTION_LIMIT',
    ),
    globalConnectionLimit: parseInteger(
      read(environment, 'GLOBAL_CONNECTION_LIMIT', '12000'),
      'GLOBAL_CONNECTION_LIMIT',
    ),
    sessionSocketLimit: parseInteger(
      read(environment, 'SESSION_SOCKET_LIMIT', '2'),
      'SESSION_SOCKET_LIMIT',
    ),
    terminalAckRateLimit: parseInteger(
      read(environment, 'TERMINAL_ACK_RATE_LIMIT', '3'),
      'TERMINAL_ACK_RATE_LIMIT',
    ),
    audioTelemetryRateLimit: parseInteger(
      read(environment, 'AUDIO_TELEMETRY_RATE_LIMIT', '6'),
      'AUDIO_TELEMETRY_RATE_LIMIT',
    ),
    createJoinIpRateLimit: parseInteger(
      read(environment, 'CREATE_JOIN_IP_RATE_LIMIT', '30'),
      'CREATE_JOIN_IP_RATE_LIMIT',
    ),
    createJoinGlobalRateLimit: parseInteger(
      read(environment, 'CREATE_JOIN_GLOBAL_RATE_LIMIT', '600'),
      'CREATE_JOIN_GLOBAL_RATE_LIMIT',
    ),
    databasePoolMax: parseInteger(
      read(environment, 'DATABASE_POOL_MAX', '10'),
      'DATABASE_POOL_MAX',
    ),
    databaseQueryTimeoutMs: parseInteger(
      read(environment, 'DATABASE_QUERY_TIMEOUT_MS', '2000'),
      'DATABASE_QUERY_TIMEOUT_MS',
    ),
    outboxBatchSize: parseInteger(
      read(environment, 'OUTBOX_BATCH_SIZE', '25'),
      'OUTBOX_BATCH_SIZE',
    ),
    ...(environment.OTLP_METRICS_ENDPOINT === undefined ||
    environment.OTLP_METRICS_ENDPOINT.length === 0
      ? {}
      : { otlpMetricsEndpoint: environment.OTLP_METRICS_ENDPOINT }),
  };

  if (!Value.Check(ConfigSchema, config)) {
    const problems = [...Value.Errors(ConfigSchema, config)]
      .map((problem) => problem.path || '/')
      .join(', ');
    throw new Error(`Invalid server configuration at: ${problems}`);
  }

  return config as ServerConfig;
}

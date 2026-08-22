import { describe, expect, it } from 'vitest';

import { CONFIG_KEYS, loadConfig } from './config.js';

const validEnvironment = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '4000',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://database.invalid/avalon',
  REDIS_URL: 'redis://cache.invalid:6379',
  RATE_LIMIT_MAX: '50',
  RATE_LIMIT_HMAC_SECRET: 'test-rate-limit-key-material-00000001',
  JOIN_RATE_LIMIT_MAX: '5',
  SESSION_TOKEN_PEPPER: 'test-session-token-pepper-material-000001',
  IDEMPOTENCY_ENCRYPTION_SECRET: 'test-idempotency-encryption-material-000001',
  SESSION_TTL_SECONDS: '1800',
  WECHAT_APP_ID: 'wx0240d55d0f3e4811',
  WECHAT_APP_SECRET: 'test-wechat-app-secret-material',
  WECHAT_IDENTITY_PEPPER: 'test-wechat-identity-pepper-material-000001',
  WECHAT_AUTH_ENFORCEMENT: 'required',
  REALTIME_PUBLIC_URL: 'wss://api.example.invalid/game-v2',
  TRUSTED_PROXY_CIDRS: '',
};

describe('M0-003 server configuration', () => {
  it('accepts only allowlisted fields and parses numeric values', () => {
    const config = loadConfig({
      ...validEnvironment,
      UNRELATED_FIELD: 'ignored',
    });

    expect(config.port).toBe(4000);
    expect(config.rateLimitMax).toBe(50);
    expect(config.joinRateLimitMax).toBe(5);
    expect(config.sessionTtlSeconds).toBe(1_800);
    expect(config.wechatAuthEnforcement).toBe('required');
    expect(config.databasePoolMax).toBe(10);
    expect(CONFIG_KEYS).not.toContain('UNRELATED_FIELD');
    expect(config).not.toHaveProperty('UNRELATED_FIELD');
  });

  it('fails closed for missing secrets and malformed endpoints', () => {
    expect(() =>
      loadConfig({ ...validEnvironment, RATE_LIMIT_HMAC_SECRET: undefined }),
    ).toThrow('RATE_LIMIT_HMAC_SECRET');
    expect(() =>
      loadConfig({ ...validEnvironment, SESSION_TOKEN_PEPPER: undefined }),
    ).toThrow('SESSION_TOKEN_PEPPER');
    expect(() =>
      loadConfig({ ...validEnvironment, WECHAT_APP_SECRET: undefined }),
    ).toThrow('WECHAT_APP_SECRET');
    expect(() =>
      loadConfig({ ...validEnvironment, WECHAT_IDENTITY_PEPPER: undefined }),
    ).toThrow('WECHAT_IDENTITY_PEPPER');
    expect(() =>
      loadConfig({ ...validEnvironment, WECHAT_APP_ID: 'wx-wrong-app' }),
    ).toThrow('Invalid server configuration');
    expect(() =>
      loadConfig({
        ...validEnvironment,
        DATABASE_URL: 'https://example.invalid',
      }),
    ).toThrow('Invalid server configuration');
  });

  it('fails closed in production without explicitly trusted proxies', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        NODE_ENV: 'production',
        TRUSTED_PROXY_CIDRS: undefined,
      }),
    ).toThrow('TRUSTED_PROXY_CIDRS');
  });

  it('accepts only HTTP(S) OTLP metric endpoints', () => {
    expect(
      loadConfig({
        ...validEnvironment,
        OTLP_METRICS_ENDPOINT: 'https://otel.example.invalid/v1/metrics',
      }).otlpMetricsEndpoint,
    ).toBe('https://otel.example.invalid/v1/metrics');
    expect(() =>
      loadConfig({
        ...validEnvironment,
        OTLP_METRICS_ENDPOINT: 'file:///tmp/metrics',
      }),
    ).toThrow('Invalid server configuration');
  });
});

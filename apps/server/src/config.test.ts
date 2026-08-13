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
};

describe('M0-003 server configuration', () => {
  it('accepts only allowlisted fields and parses numeric values', () => {
    const config = loadConfig({
      ...validEnvironment,
      UNRELATED_FIELD: 'ignored',
    });

    expect(config.port).toBe(4000);
    expect(config.rateLimitMax).toBe(50);
    expect(CONFIG_KEYS).not.toContain('UNRELATED_FIELD');
    expect(config).not.toHaveProperty('UNRELATED_FIELD');
  });

  it('fails closed for missing secrets and malformed endpoints', () => {
    expect(() =>
      loadConfig({ ...validEnvironment, RATE_LIMIT_HMAC_SECRET: undefined }),
    ).toThrow('RATE_LIMIT_HMAC_SECRET');
    expect(() =>
      loadConfig({
        ...validEnvironment,
        DATABASE_URL: 'https://example.invalid',
      }),
    ).toThrow('Invalid server configuration');
  });
});

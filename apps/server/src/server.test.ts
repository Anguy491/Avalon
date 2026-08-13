import { describe, expect, it } from 'vitest';

import type { DependencyChecks } from './dependencies.js';
import { createLoggerOptions } from './observability.js';
import { createServer } from './server.js';
import { TEST_CONFIG } from './test-config.js';

const healthyDependencies = (): DependencyChecks => ({
  checkPostgres: () => Promise.resolve(),
  checkRedis: () => Promise.resolve(),
  close: () => Promise.resolve(),
});

describe('M0-003 health endpoints', () => {
  it('returns minimal live and ready payloads with no-store headers', async () => {
    const server = await createServer(TEST_CONFIG, healthyDependencies());

    const live = await server.app.inject({
      method: 'GET',
      url: '/v1/health/live',
    });
    const ready = await server.app.inject({
      method: 'GET',
      url: '/v1/health/ready',
    });

    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: 'ok' });
    expect(live.headers['cache-control']).toBe('no-store');
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready' });

    await server.close();
  });

  it('reports dependency failure without leaking its cause', async () => {
    const dependencies = healthyDependencies();
    dependencies.checkPostgres = () =>
      Promise.reject(new Error('database.internal.invalid:5432/private'));
    const server = await createServer(TEST_CONFIG, dependencies);

    const response = await server.app.inject({
      method: 'GET',
      url: '/v1/health/ready',
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).toBe('{"status":"not_ready"}');
    expect(response.body).not.toContain('database.internal');
    await server.close();
  });

  it('applies a basic HMAC-keyed request limit', async () => {
    const server = await createServer(
      { ...TEST_CONFIG, rateLimitMax: 2 },
      healthyDependencies(),
    );

    await server.app.inject({ method: 'GET', url: '/v1/health/live' });
    await server.app.inject({ method: 'GET', url: '/v1/health/live' });
    const limited = await server.app.inject({
      method: 'GET',
      url: '/v1/health/live',
    });

    expect(limited.statusCode).toBe(429);
    await server.close();
  });
});

describe('M0 / TM-002 and TM-004 observability allowlist', () => {
  it('redacts token and game-secret paths', () => {
    const logger = createLoggerOptions(TEST_CONFIG);
    const redact =
      typeof logger === 'object' && 'redact' in logger
        ? logger.redact
        : undefined;
    const paths = Array.isArray(redact) ? redact : (redact?.paths ?? []);

    expect(paths).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        '*.sessionToken',
        '*.roleAssignments',
        '*.privateKnowledge',
        '*.selfRole',
        '*.selfAlignment',
        '*.knownPlayers',
        '*.allowedQuestChoices',
        '*.questChoices',
        '*.teamVotes',
      ]),
    );
  });
});

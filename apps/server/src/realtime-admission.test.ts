import type { RedisClientType } from 'redis';
import { describe, expect, it } from 'vitest';

import { RealtimeAdmission } from './realtime-admission.js';
import { TEST_CONFIG } from './test-config.js';

function fixedWindowRedis(counts: readonly number[]): RedisClientType {
  let call = 0;
  const redis = {
    isOpen: true,
    multi() {
      const chain = {
        incr() {
          return chain;
        },
        pExpire() {
          return chain;
        },
        exec() {
          const count = counts[call] ?? Number.POSITIVE_INFINITY;
          call += 1;
          return Promise.resolve([count, 1]);
        },
      };
      return chain;
    },
  };
  return redis as unknown as RedisClientType;
}

describe('M7 Engine.IO and pending-auth admission', () => {
  it('rate limits the trusted client IP before namespace authentication', async () => {
    const admission = new RealtimeAdmission(
      fixedWindowRedis([1, 2]),
      { ...TEST_CONFIG, handshakeIpRateLimit: 1 },
      'instance-a',
    );
    const now = new Date('2026-08-15T00:00:00.000Z');

    await expect(
      admission.allowEngineHandshake('203.0.113.1', now),
    ).resolves.toBe(true);
    await expect(
      admission.allowEngineHandshake('203.0.113.1', now),
    ).resolves.toBe(false);
  });

  it('reserves pending capacity before awaiting authentication', async () => {
    let release: ((value: string) => void) | undefined;
    const blocked = new Promise<string>((resolve) => {
      release = resolve;
    });
    const admission = new RealtimeAdmission(
      fixedWindowRedis([]),
      { ...TEST_CONFIG, pendingAuthLimit: 1 },
      'instance-a',
    );

    const first = admission.authenticateWithinBudget(() => blocked);
    await expect(
      admission.authenticateWithinBudget(() => Promise.resolve('second')),
    ).rejects.toThrow('AUTH_CAPACITY');
    release?.('first');
    await expect(first).resolves.toBe('first');
  });

  it('fails closed when authentication exceeds three seconds', async () => {
    const admission = new RealtimeAdmission(
      fixedWindowRedis([]),
      { ...TEST_CONFIG, authTimeoutMs: 100 },
      'instance-a',
    );

    await expect(
      admission.authenticateWithinBudget(
        () => new Promise<string>(() => undefined),
      ),
    ).rejects.toThrow('AUTH_TIMEOUT');
  });
});

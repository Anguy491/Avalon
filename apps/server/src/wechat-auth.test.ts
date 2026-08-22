import type { RedisClientType } from 'redis';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RuntimePorts } from './runtime-ports.js';
import { TEST_CONFIG } from './test-config.js';
import {
  WECHAT_IDENTITY_TTL_SECONDS,
  WechatIdentityService,
  WechatLoginError,
  createWechatLoginPort,
} from './wechat-auth.js';

function response(payload: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(payload) } as Response;
}

function fixedPorts(): RuntimePorts {
  return {
    clock: { now: () => new Date('2026-08-20T12:00:00.000Z') },
    ids: { next: () => '10000000-0000-4000-8000-000000000001' },
    random: { bytes: (length) => new Uint8Array(length).fill(7) },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AC-019 / TM-002 WeChat code exchange', () => {
  it('exchanges the one-use code through the official endpoint', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      void input;
      return Promise.resolve(
        response({
          openid: 'raw-open-id',
          unionid: 'raw-union-id',
          session_key: 'raw-session-key',
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createWechatLoginPort(TEST_CONFIG).exchange('one-use-code'),
    ).resolves.toEqual({
      openid: 'raw-open-id',
      sessionKey: 'raw-session-key',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeDefined();
    const requestedUrl =
      request instanceof Request
        ? request.url
        : request instanceof URL
          ? request.href
          : (request ?? '');
    expect(requestedUrl).toContain('js_code=one-use-code');
    expect(requestedUrl).toContain(`appid=${TEST_CONFIG.wechatAppId}`);
  });

  it.each([
    [{ errcode: 40029 }, 'INVALID'],
    [{ errcode: 40226 }, 'INVALID'],
    [{ errcode: 45011 }, 'RATE_LIMITED'],
    [{ errcode: -1 }, 'UNAVAILABLE'],
    [{ openid: 'missing-session-key' }, 'UNAVAILABLE'],
  ] as const)(
    'maps stable upstream failures for %j',
    async (payload, failure) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(response(payload))),
      );
      const exchange = createWechatLoginPort(TEST_CONFIG).exchange('bad-code');
      await expect(exchange).rejects.toMatchObject({ failure });
    },
  );

  it('maps transport failures without leaking their message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('secret-upstream-details'))),
    );
    await expect(
      createWechatLoginPort(TEST_CONFIG).exchange('code'),
    ).rejects.toEqual(new WechatLoginError('UNAVAILABLE'));
  });
});

describe('AC-019 / TM-010 ephemeral WeChat identity', () => {
  it('stores only token and subject digests for exactly five minutes', async () => {
    const storage = new Map<string, string>();
    const setCalls: unknown[][] = [];
    const redis = {
      isOpen: true,
      set(key: string, value: string, options: unknown) {
        storage.set(key, value);
        setCalls.push([key, value, options]);
        return Promise.resolve('OK');
      },
      get(key: string) {
        return Promise.resolve(storage.get(key) ?? null);
      },
    } as unknown as RedisClientType;
    const service = new WechatIdentityService(
      redis,
      TEST_CONFIG,
      fixedPorts(),
      {
        exchange: () =>
          Promise.resolve({
            openid: 'raw-open-id',
            sessionKey: 'raw-session-key',
          }),
      },
    );

    const result = await service.login('one-use-code');
    expect(result.expiresAt).toBe('2026-08-20T12:05:00.000Z');
    expect(result.wechatIdentityToken).toHaveLength(43);
    expect(setCalls[0]?.[2]).toEqual({
      expiration: { type: 'EX', value: WECHAT_IDENTITY_TTL_SECONDS },
    });
    const stored = JSON.stringify([...storage.entries()]);
    expect(stored).not.toContain('raw-open-id');
    expect(stored).not.toContain('raw-session-key');
    expect(stored).not.toContain('one-use-code');
    expect(stored).not.toContain(result.wechatIdentityToken);
    await expect(service.resolve(result.wechatIdentityToken)).resolves.toMatch(
      /^[0-9a-f]{64}$/u,
    );
  });
});

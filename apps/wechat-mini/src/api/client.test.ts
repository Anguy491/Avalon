import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockTaroResponse {
  readonly statusCode: number;
  readonly data: unknown;
}

const taroMocks = vi.hoisted(() => {
  Object.assign(process.env, {
    TARO_APP_API_URL: 'http://127.0.0.1:3000',
    TARO_APP_JOIN_HOST: 'join.example.test',
    TARO_APP_VERSION: '0.1.0-test',
  });
  return {
    login: vi.fn<() => Promise<{ readonly code: string }>>(),
    request: vi.fn<(options: unknown) => Promise<MockTaroResponse>>(),
  };
});

vi.mock('@tarojs/taro', () => ({ default: taroMocks }));

import {
  ApiError,
  clearWechatIdentity,
  getWechatIdentityToken,
  joinRoom,
  userFacingError,
} from './client';

const identity = (token: string, expiresAtMs: number): MockTaroResponse => ({
  statusCode: 200,
  data: {
    protocolVersion: 2,
    wechatIdentityToken: token,
    expiresAt: new Date(expiresAtMs).toISOString(),
  },
});

const invalidIdentity = (): MockTaroResponse => ({
  statusCode: 401,
  data: {
    error: {
      code: 'WECHAT_AUTH_INVALID',
      diagnosticId: 'diag_auth_invalid',
      retryable: false,
    },
  },
});

describe('AC-019 WeChat identity client', () => {
  beforeEach(() => {
    clearWechatIdentity();
    taroMocks.login.mockReset();
    taroMocks.request.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps a valid identity only in the module memory cache', async () => {
    const now = Date.parse('2026-08-20T12:00:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    taroMocks.login.mockResolvedValue({ code: 'one-use-code' });
    taroMocks.request.mockResolvedValueOnce(
      identity('a'.repeat(43), now + 5 * 60_000),
    );

    await expect(getWechatIdentityToken()).resolves.toBe('a'.repeat(43));
    await expect(getWechatIdentityToken()).resolves.toBe('a'.repeat(43));

    expect(taroMocks.login).toHaveBeenCalledTimes(1);
    expect(taroMocks.request).toHaveBeenCalledTimes(1);
    const authOptions = taroMocks.request.mock.calls[0]?.[0];
    expect(authOptions).toMatchObject({
      data: { loginCode: 'one-use-code' },
    });
    if (
      typeof authOptions !== 'object' ||
      authOptions === null ||
      !('url' in authOptions) ||
      typeof authOptions.url !== 'string'
    ) {
      throw new Error('Taro auth request did not include a URL');
    }
    expect(authOptions.url).toContain('/v2/auth/wechat');
  });

  it('refreshes within 30 seconds of expiry', async () => {
    const now = Date.parse('2026-08-20T12:00:00.000Z');
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
    taroMocks.login
      .mockResolvedValueOnce({ code: 'first-code' })
      .mockResolvedValueOnce({ code: 'second-code' });
    taroMocks.request
      .mockResolvedValueOnce(identity('a'.repeat(43), now + 5 * 60_000))
      .mockResolvedValueOnce(identity('b'.repeat(43), now + 10 * 60_000));

    await expect(getWechatIdentityToken()).resolves.toBe('a'.repeat(43));
    nowSpy.mockReturnValue(now + 4 * 60_000 + 31_000);
    await expect(getWechatIdentityToken()).resolves.toBe('b'.repeat(43));

    expect(taroMocks.login).toHaveBeenCalledTimes(2);
  });

  it('does not repopulate the cache when a background clear races an exchange', async () => {
    const now = Date.parse('2026-08-20T12:00:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    let resolveExchange: ((response: MockTaroResponse) => void) | undefined;
    const delayedExchange = new Promise<MockTaroResponse>((resolve) => {
      resolveExchange = resolve;
    });
    taroMocks.login
      .mockResolvedValueOnce({ code: 'background-code' })
      .mockResolvedValueOnce({ code: 'foreground-code' });
    taroMocks.request
      .mockReturnValueOnce(delayedExchange)
      .mockResolvedValueOnce(identity('b'.repeat(43), now + 5 * 60_000));

    const backgroundRequest = getWechatIdentityToken();
    await vi.waitFor(() => {
      expect(taroMocks.request).toHaveBeenCalledTimes(1);
    });
    clearWechatIdentity();
    resolveExchange?.(identity('a'.repeat(43), now + 5 * 60_000));

    await expect(backgroundRequest).rejects.toMatchObject({
      detail: { code: 'WECHAT_AUTH_INVALID' },
    });
    await expect(getWechatIdentityToken()).resolves.toBe('b'.repeat(43));
    expect(taroMocks.login).toHaveBeenCalledTimes(2);
  });

  it('refreshes and retries once with the original idempotency key', async () => {
    const now = Date.parse('2026-08-20T12:00:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    taroMocks.login
      .mockResolvedValueOnce({ code: 'first-code' })
      .mockResolvedValueOnce({ code: 'second-code' });
    taroMocks.request
      .mockResolvedValueOnce(identity('a'.repeat(43), now + 5 * 60_000))
      .mockResolvedValueOnce(invalidIdentity())
      .mockResolvedValueOnce(identity('b'.repeat(43), now + 5 * 60_000))
      .mockResolvedValueOnce(invalidIdentity());

    await expect(
      joinRoom('ABC123', '10000000-0000-4000-8000-000000000001', {
        nickname: 'Arthur',
        client: {
          protocolVersion: 2,
          platform: 'WECHAT_MINIPROGRAM',
          appVersion: '1.0.0',
          installationId: '20000000-0000-4000-8000-000000000001',
          voicePackVersions: ['zh-CN-v1'],
        },
      }),
    ).rejects.toMatchObject({ detail: { code: 'WECHAT_AUTH_INVALID' } });

    expect(taroMocks.login).toHaveBeenCalledTimes(2);
    expect(taroMocks.request).toHaveBeenCalledTimes(4);
    expect(taroMocks.request.mock.calls[1]?.[0]).toMatchObject({
      header: {
        'Idempotency-Key': '10000000-0000-4000-8000-000000000001',
        'X-WeChat-Identity': 'a'.repeat(43),
      },
    });
    expect(taroMocks.request.mock.calls[3]?.[0]).toMatchObject({
      header: {
        'Idempotency-Key': '10000000-0000-4000-8000-000000000001',
        'X-WeChat-Identity': 'b'.repeat(43),
      },
    });
  });

  it('maps protocol errors and retains only the anonymous diagnostic code', () => {
    const message = userFacingError(
      new ApiError(
        {
          code: 'NICKNAME_CONFLICT',
          diagnosticId: 'diag_123456',
          retryable: false,
        },
        409,
      ),
    );
    expect(message).toBe('这个昵称已经有人使用。 诊断码：diag_123456');
  });
});

import { createHmac } from 'node:crypto';

import type { RedisClientType } from 'redis';

import type { WechatIdentityBootstrap } from '@avalon/protocol';

import type { ServerConfig } from './config.js';
import type { RuntimePorts } from './runtime-ports.js';
import { addSeconds, issueSessionToken, tokenDigest } from './security.js';

export const WECHAT_IDENTITY_TTL_SECONDS = 5 * 60;
const CODE_TO_SESSION_TIMEOUT_MS = 3_000;
const CODE_TO_SESSION_URL = 'https://api.weixin.qq.com/sns/jscode2session';

export interface WechatCodeExchange {
  readonly openid: string;
  readonly sessionKey: string;
}

export interface WechatLoginPort {
  exchange(loginCode: string): Promise<WechatCodeExchange>;
}

export type WechatLoginFailure = 'INVALID' | 'RATE_LIMITED' | 'UNAVAILABLE';

export class WechatLoginError extends Error {
  constructor(readonly failure: WechatLoginFailure) {
    super(failure);
    this.name = 'WechatLoginError';
  }
}

interface CodeToSessionResponse {
  readonly errcode?: number;
  readonly openid?: string;
  readonly session_key?: string;
}

function isCodeToSessionResponse(
  value: unknown,
): value is CodeToSessionResponse {
  return typeof value === 'object' && value !== null;
}

export function createWechatLoginPort(
  config: Pick<ServerConfig, 'wechatAppId' | 'wechatAppSecret'>,
): WechatLoginPort {
  return {
    async exchange(loginCode) {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, CODE_TO_SESSION_TIMEOUT_MS);
      try {
        const query = new URLSearchParams({
          appid: config.wechatAppId,
          secret: config.wechatAppSecret,
          js_code: loginCode,
          grant_type: 'authorization_code',
        });
        const response = await fetch(
          `${CODE_TO_SESSION_URL}?${query.toString()}`,
          {
            method: 'GET',
            signal: controller.signal,
            headers: { accept: 'application/json' },
          },
        );
        if (!response.ok) throw new WechatLoginError('UNAVAILABLE');
        const payload: unknown = await response.json();
        if (!isCodeToSessionResponse(payload)) {
          throw new WechatLoginError('UNAVAILABLE');
        }
        if (payload.errcode === 40029 || payload.errcode === 40226) {
          throw new WechatLoginError('INVALID');
        }
        if (payload.errcode === 45011) {
          throw new WechatLoginError('RATE_LIMITED');
        }
        if (
          payload.errcode !== undefined ||
          typeof payload.openid !== 'string' ||
          payload.openid.length === 0 ||
          typeof payload.session_key !== 'string' ||
          payload.session_key.length === 0
        ) {
          throw new WechatLoginError('UNAVAILABLE');
        }
        return { openid: payload.openid, sessionKey: payload.session_key };
      } catch (error) {
        if (error instanceof WechatLoginError) throw error;
        throw new WechatLoginError('UNAVAILABLE');
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export class WechatIdentityService {
  constructor(
    private readonly redis: RedisClientType,
    private readonly config: Pick<
      ServerConfig,
      'wechatAppId' | 'wechatIdentityPepper'
    >,
    private readonly ports: RuntimePorts,
    private readonly loginPort: WechatLoginPort,
  ) {}

  private tokenKey(token: string): string {
    return `avalon:wechat-identity:${tokenDigest(
      token,
      this.config.wechatIdentityPepper,
    )}`;
  }

  private subjectDigest(openid: string): string {
    return createHmac('sha256', this.config.wechatIdentityPepper)
      .update(`${this.config.wechatAppId}:${openid}`)
      .digest('hex');
  }

  async login(loginCode: string): Promise<WechatIdentityBootstrap> {
    const exchange = await this.loginPort.exchange(loginCode);
    const subjectDigest = this.subjectDigest(exchange.openid);
    const token = issueSessionToken(this.ports.random);
    const now = this.ports.clock.now();
    const expiresAt = addSeconds(now, WECHAT_IDENTITY_TTL_SECONDS);
    if (!this.redis.isOpen) await this.redis.connect();
    await this.redis.set(this.tokenKey(token), subjectDigest, {
      expiration: { type: 'EX', value: WECHAT_IDENTITY_TTL_SECONDS },
    });
    return {
      protocolVersion: 2,
      wechatIdentityToken: token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async resolve(token: string): Promise<string | undefined> {
    if (!this.redis.isOpen) await this.redis.connect();
    return (await this.redis.get(this.tokenKey(token))) ?? undefined;
  }
}

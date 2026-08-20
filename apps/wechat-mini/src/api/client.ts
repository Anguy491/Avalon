import Taro from '@tarojs/taro';

import {
  isErrorResponse,
  isReadRoomViewResponse,
  isSessionBootstrap,
  type ClientCapabilities,
  type CreateRoomRequest,
  type ErrorDetail,
  type JoinRoomRequest,
  type ReadRoomViewResponse,
  type SessionBootstrap,
} from '@avalon/protocol/mobile';

const API_ORIGIN = (process.env.TARO_APP_API_URL ?? 'http://127.0.0.1:3000')
  .trim()
  .replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    readonly detail: ErrorDetail,
    readonly httpStatus: number,
  ) {
    super(detail.code);
    this.name = 'ApiError';
  }
}

function protocolError(): ApiError {
  return new ApiError(
    {
      code: 'INTERNAL_ERROR',
      diagnosticId: 'client_protocol',
      retryable: true,
    },
    0,
  );
}

interface RequestOptions {
  readonly method: 'GET' | 'POST';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

async function requestJson(
  path: string,
  options: RequestOptions,
): Promise<unknown> {
  try {
    const response = await Taro.request<unknown>({
      url: `${API_ORIGIN}${path}`,
      method: options.method,
      timeout: 10_000,
      data: options.body,
      header: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Protocol-Version': '2',
        ...options.headers,
      },
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      if (isErrorResponse(response.data)) {
        throw new ApiError(response.data.error, response.statusCode);
      }
      throw protocolError();
    }
    return response.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      {
        code: 'INTERNAL_ERROR',
        diagnosticId: 'client_network',
        retryable: true,
      },
      0,
    );
  }
}

function requireBootstrap(value: unknown): SessionBootstrap {
  if (!isSessionBootstrap(value)) throw protocolError();
  return value;
}

export function clientCapabilities(installationId: string): ClientCapabilities {
  return {
    protocolVersion: 2,
    platform: 'WECHAT_MINIPROGRAM',
    appVersion: process.env.TARO_APP_VERSION ?? '0.1.0',
    installationId,
    voicePackVersions: ['zh-CN-v1'],
  };
}

export async function createRoom(
  idempotencyKey: string,
  request: CreateRoomRequest,
): Promise<SessionBootstrap> {
  return requireBootstrap(
    await requestJson('/v2/rooms', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: request,
    }),
  );
}

export async function joinRoom(
  roomCode: string,
  idempotencyKey: string,
  request: JoinRoomRequest,
): Promise<SessionBootstrap> {
  return requireBootstrap(
    await requestJson(`/v2/rooms/${roomCode}/players`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: request,
    }),
  );
}

export async function resumeSession(
  sessionToken: string,
  idempotencyKey: string,
  installationId: string,
): Promise<SessionBootstrap> {
  return requireBootstrap(
    await requestJson('/v2/sessions/resume', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'Idempotency-Key': idempotencyKey,
      },
      body: { client: clientCapabilities(installationId) },
    }),
  );
}

export async function readCurrentRoomView(
  sessionToken: string,
): Promise<ReadRoomViewResponse> {
  const value = await requestJson('/v2/rooms/current/view', {
    method: 'GET',
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (!isReadRoomViewResponse(value)) throw protocolError();
  return value;
}

const ERROR_MESSAGES: Readonly<Partial<Record<ErrorDetail['code'], string>>> = {
  INVALID_ROOM_CODE: '房间号无效或房间不存在。',
  ROOM_FULL: '房间人数已满。',
  ROOM_ALREADY_STARTED: '对局已经开始，无法加入。',
  ROOM_EXPIRED: '房间已经过期。',
  SESSION_INVALID: '本机会话已经失效。',
  STALE_VERSION: '对局状态已经更新，请确认最新内容。',
  RATE_LIMITED: '操作过于频繁，请稍后重试。',
  NICKNAME_TAKEN: '这个昵称已经有人使用。',
  VALIDATION_ERROR: '输入内容不符合要求。',
};

export function userFacingError(error: unknown): string {
  if (error instanceof ApiError) {
    const base = ERROR_MESSAGES[error.detail.code] ?? '网络或服务暂时不可用。';
    return `${base} 诊断码：${error.detail.diagnosticId}`;
  }
  return '网络或服务暂时不可用。';
}

export function isInvalidSession(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.detail.code === 'SESSION_INVALID' ||
      error.detail.code === 'ROOM_EXPIRED')
  );
}

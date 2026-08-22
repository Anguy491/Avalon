import Taro from '@tarojs/taro';

import {
  isErrorResponse,
  isReadRoomViewResponse,
  isRoomConfigValidationResponse,
  isSessionBootstrap,
  isWechatIdentityBootstrap,
  type ClientCapabilities,
  type CreateRoomRequest,
  type ErrorDetail,
  type JoinRoomRequest,
  type ReadRoomViewResponse,
  type RoomConfigValidationRequest,
  type RoomConfigValidationResponse,
  type SessionBootstrap,
} from '@avalon/protocol/mobile';

import {
  WECHAT_API_ORIGIN,
  WECHAT_APP_VERSION,
} from '../runtime/public-config';

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

interface CachedWechatIdentity {
  readonly token: string;
  readonly expiresAtMs: number;
}

let cachedWechatIdentity: CachedWechatIdentity | undefined;
let pendingWechatIdentity: Promise<CachedWechatIdentity> | undefined;
let wechatIdentityGeneration = 0;

async function requestJson(
  path: string,
  options: RequestOptions,
): Promise<unknown> {
  try {
    const response = await Taro.request<unknown>({
      url: `${WECHAT_API_ORIGIN}${path}`,
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

function isWechatAuthInvalid(error: unknown): boolean {
  return (
    error instanceof ApiError && error.detail.code === 'WECHAT_AUTH_INVALID'
  );
}

async function exchangeWechatIdentity(): Promise<CachedWechatIdentity> {
  let loginCode: string;
  try {
    const result = await Taro.login({ timeout: 5_000 });
    if (typeof result.code !== 'string' || result.code.length === 0) {
      throw new Error('wx.login returned no code');
    }
    loginCode = result.code;
  } catch {
    throw new ApiError(
      {
        code: 'WECHAT_AUTH_UNAVAILABLE',
        diagnosticId: 'client_wechat_login',
        retryable: true,
      },
      0,
    );
  }
  const value = await requestJson('/v2/auth/wechat', {
    method: 'POST',
    body: { loginCode },
  });
  if (!isWechatIdentityBootstrap(value)) throw protocolError();
  return {
    token: value.wechatIdentityToken,
    expiresAtMs: Date.parse(value.expiresAt),
  };
}

export function clearWechatIdentity(): void {
  wechatIdentityGeneration += 1;
  cachedWechatIdentity = undefined;
  pendingWechatIdentity = undefined;
}

export async function getWechatIdentityToken(
  forceRefresh = false,
): Promise<string> {
  if (forceRefresh) cachedWechatIdentity = undefined;
  if (
    cachedWechatIdentity !== undefined &&
    cachedWechatIdentity.expiresAtMs > Date.now() + 30_000
  ) {
    return cachedWechatIdentity.token;
  }
  const generation = wechatIdentityGeneration;
  pendingWechatIdentity ??= exchangeWechatIdentity().finally(() => {
    if (generation === wechatIdentityGeneration) {
      pendingWechatIdentity = undefined;
    }
  });
  const pending = pendingWechatIdentity;
  const resolved = await pending;
  if (generation !== wechatIdentityGeneration) {
    throw new ApiError(
      {
        code: 'WECHAT_AUTH_INVALID',
        diagnosticId: 'client_wechat_identity_cleared',
        retryable: true,
      },
      0,
    );
  }
  cachedWechatIdentity = resolved;
  return cachedWechatIdentity.token;
}

async function withWechatIdentity<T>(
  operation: (identityToken: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const identityToken = await getWechatIdentityToken(attempt === 1);
    try {
      return await operation(identityToken);
    } catch (error) {
      if (attempt === 0 && isWechatAuthInvalid(error)) {
        clearWechatIdentity();
        continue;
      }
      throw error;
    }
  }
  throw protocolError();
}

export function clientCapabilities(installationId: string): ClientCapabilities {
  return {
    protocolVersion: 2,
    platform: 'WECHAT_MINIPROGRAM',
    appVersion: WECHAT_APP_VERSION,
    installationId,
    voicePackVersions: ['zh-CN-v1'],
  };
}

export async function createRoom(
  idempotencyKey: string,
  request: CreateRoomRequest,
): Promise<SessionBootstrap> {
  return withWechatIdentity(async (identityToken) =>
    requireBootstrap(
      await requestJson('/v2/rooms', {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
          'X-WeChat-Identity': identityToken,
        },
        body: request,
      }),
    ),
  );
}

export async function joinRoom(
  roomCode: string,
  idempotencyKey: string,
  request: JoinRoomRequest,
): Promise<SessionBootstrap> {
  return withWechatIdentity(async (identityToken) =>
    requireBootstrap(
      await requestJson(`/v2/rooms/${roomCode}/players`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
          'X-WeChat-Identity': identityToken,
        },
        body: request,
      }),
    ),
  );
}

export async function resumeSession(
  sessionToken: string,
  idempotencyKey: string,
  installationId: string,
): Promise<SessionBootstrap> {
  return withWechatIdentity(async (identityToken) =>
    requireBootstrap(
      await requestJson('/v2/sessions/resume', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Idempotency-Key': idempotencyKey,
          'X-WeChat-Identity': identityToken,
        },
        body: { client: clientCapabilities(installationId) },
      }),
    ),
  );
}

export async function readCurrentRoomView(
  sessionToken: string,
): Promise<ReadRoomViewResponse> {
  return withWechatIdentity(async (identityToken) => {
    const value = await requestJson('/v2/rooms/current/view', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'X-WeChat-Identity': identityToken,
      },
    });
    if (!isReadRoomViewResponse(value)) throw protocolError();
    return value;
  });
}

export async function validateRoomConfig(
  request: RoomConfigValidationRequest,
): Promise<RoomConfigValidationResponse> {
  const value = await requestJson('/v2/room-config/validate', {
    method: 'POST',
    body: request,
  });
  if (!isRoomConfigValidationResponse(value)) throw protocolError();
  return value;
}

const ERROR_MESSAGES: Readonly<Record<ErrorDetail['code'], string>> = {
  INVALID_ROOM_CODE: '房间号无效或房间不存在。',
  ROOM_FULL: '房间人数已满。',
  ROOM_NOT_JOINABLE: '对局已经开始，无法加入。',
  ROOM_EXPIRED: '房间已经过期。',
  SESSION_INVALID: '本机会话已经失效。',
  NICKNAME_CONFLICT: '这个昵称已经有人使用。',
  INVALID_NICKNAME: '昵称不符合要求。',
  NOT_HOST: '只有房主可以执行此操作。',
  NOT_LEADER: '只有当前队长可以执行此操作。',
  NOT_ASSASSIN: '只有刺客可以选择刺杀目标。',
  INVALID_PHASE: '当前阶段不能执行此操作。',
  INVALID_PHASE_STAGE: '当前步骤不能执行此操作。',
  PHASE_HELD: '请等待房主继续。',
  STALE_VERSION: '对局状态已经更新，请确认最新内容。',
  DUPLICATE_COMMAND_CONFLICT: '同一操作编号对应了不同内容，请重试。',
  INVALID_CONFIG: '角色配置不符合规则。',
  INVALID_SEAT_ORDER: '座位顺序不符合要求。',
  INVALID_TEAM_SIZE: '队伍人数不符合要求。',
  INVALID_TEAM_MEMBER: '队伍中包含无效玩家。',
  INVALID_VOTE: '投票选择无效。',
  INVALID_TARGET: '目标玩家无效。',
  PLAYER_NOT_ON_TEAM: '你不在本次任务队伍中。',
  GOOD_CANNOT_FAIL: '正义角色只能选择任务成功。',
  ALREADY_SUBMITTED: '你已经提交过本阶段操作。',
  HOST_CANNOT_LEAVE: '房主不能直接离开房间。',
  PLAYERS_NOT_READY: '仍有玩家未准备。',
  PLAYERS_OFFLINE: '仍有玩家离线。',
  AUDIO_CUE_NOT_FOUND: '当前语音无法重播。',
  INVALID_PAUSE_REASON: '暂停原因无效。',
  PAUSE_VOTE_NOT_AVAILABLE: '暂时不能发起终止投票。',
  PAUSE_VOTE_NOT_ELIGIBLE: '你没有本次终止投票资格。',
  PAUSE_VOTE_CLOSED: '本次终止投票已经结束。',
  UPGRADE_REQUIRED: '当前版本过旧，请更新小程序。',
  RATE_LIMITED: '操作过于频繁，请稍后重试。',
  VALIDATION_ERROR: '输入内容不符合要求。',
  PAYLOAD_TOO_LARGE: '提交内容过大。',
  WECHAT_AUTH_INVALID: '微信身份验证已过期，请重试。',
  WECHAT_AUTH_UNAVAILABLE: '微信登录服务暂时不可用。',
  WECHAT_IDENTITY_CONFLICT: '这个微信账号已经在该房间占有一个座位。',
  UNAUTHORIZED: '当前会话无权执行此操作。',
  INTERNAL_ERROR: '服务暂时不可用。',
};

export function userFacingError(error: unknown): string {
  if (error instanceof ApiError) {
    const base = ERROR_MESSAGES[error.detail.code] ?? '操作失败。';
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

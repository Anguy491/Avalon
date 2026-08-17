import Constants from 'expo-constants';
import { Platform } from 'react-native';

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

import { supportedVoicePackVersions } from '@/audio/voice-pack.generated';

const REQUEST_TIMEOUT_MS = 10_000;
const API_ORIGIN = (process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:3000')
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

async function requestJson(
  path: string,
  init: Omit<RequestInit, 'headers'> & {
    readonly headers?: Readonly<Record<string, string>>;
  },
): Promise<{ readonly body: unknown; readonly status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const headers: [string, string][] = [
      ...Object.entries(init.headers ?? {}),
      ['Accept', 'application/json'],
      ['Content-Type', 'application/json'],
      ['X-Protocol-Version', '2'],
    ];
    const response = await fetch(`${API_ORIGIN}${path}`, {
      ...init,
      signal: controller.signal,
      headers,
    });
    const body = (await response.json()) as unknown;
    if (!response.ok) {
      if (isErrorResponse(body)) {
        throw new ApiError(body.error, response.status);
      }
      throw protocolError();
    }
    return { body, status: response.status };
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
  } finally {
    clearTimeout(timer);
  }
}

function requireBootstrap(body: unknown): SessionBootstrap {
  if (!isSessionBootstrap(body)) throw protocolError();
  return body;
}

export function clientCapabilities(installationId: string): ClientCapabilities {
  return {
    protocolVersion: 2,
    platform: Platform.OS === 'android' ? 'ANDROID' : 'IOS',
    appVersion: Constants.expoConfig?.version ?? '0.1.0',
    installationId,
    voicePackVersions: [...supportedVoicePackVersions()],
  };
}

export async function createRoom(
  idempotencyKey: string,
  request: CreateRoomRequest,
): Promise<SessionBootstrap> {
  const { body } = await requestJson('/v2/rooms', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(request),
  });
  return requireBootstrap(body);
}

export async function joinRoom(
  roomCode: string,
  idempotencyKey: string,
  request: JoinRoomRequest,
): Promise<SessionBootstrap> {
  const { body } = await requestJson(`/v2/rooms/${roomCode}/players`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(request),
  });
  return requireBootstrap(body);
}

export async function resumeSession(
  sessionToken: string,
  idempotencyKey: string,
  installationId: string,
): Promise<SessionBootstrap> {
  const { body } = await requestJson('/v2/sessions/resume', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ client: clientCapabilities(installationId) }),
  });
  return requireBootstrap(body);
}

export async function readCurrentRoomView(
  sessionToken: string,
): Promise<ReadRoomViewResponse> {
  const { body } = await requestJson('/v2/rooms/current/view', {
    method: 'GET',
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (!isReadRoomViewResponse(body)) throw protocolError();
  return body;
}

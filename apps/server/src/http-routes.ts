import { createHmac } from 'node:crypto';

import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  CreateRoomRequestSchema,
  ErrorResponseSchema,
  JoinRoomRequestSchema,
  ReadRoomViewResponseSchema,
  ResumeSessionRequestSchema,
  SessionBootstrapSchema,
  UuidSchema,
  type CreateRoomRequest,
  type ErrorResponse,
  type JoinRoomRequest,
  type ResumeSessionRequest,
} from '@avalon/protocol';

import type { ServerConfig } from './config.js';
import { ServiceError } from './room-service.js';
import type { RoomService } from './room-service.js';
import type { RuntimePorts } from './runtime-ports.js';

const idempotencyHeadersSchema = Type.Object(
  {
    'idempotency-key': UuidSchema,
    'x-protocol-version': Type.Literal('1'),
  },
  { additionalProperties: true },
);

const authenticatedHeadersSchema = Type.Object(
  {
    authorization: Type.String({ pattern: '^Bearer [A-Za-z0-9_-]{22,}$' }),
    'x-protocol-version': Type.Literal('1'),
  },
  { additionalProperties: true },
);

const authenticatedIdempotencyHeadersSchema = Type.Intersect([
  authenticatedHeadersSchema,
  idempotencyHeadersSchema,
]);

const roomCodeParamsSchema = Type.Object(
  { roomCode: Type.String({ minLength: 6, maxLength: 6 }) },
  { additionalProperties: false },
);

function bearerToken(authorization: string): string {
  return authorization.slice('Bearer '.length);
}

function diagnosticId(ports: RuntimePorts): string {
  return `diag_${ports.ids.next()}`;
}

export function errorResponse(
  error: ServiceError,
  ports: RuntimePorts,
): ErrorResponse {
  return {
    error: {
      code: error.code,
      diagnosticId: diagnosticId(ports),
      retryable: error.retryable,
      ...(error.currentStateVersion === undefined
        ? {}
        : { currentStateVersion: error.currentStateVersion }),
    },
  };
}

export function installSafeErrorHandler(
  app: FastifyInstance,
  ports: RuntimePorts,
): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ServiceError) {
      return reply.code(error.httpStatus).send(errorResponse(error, ports));
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      ('validation' in error ||
        ('statusCode' in error && error.statusCode === 400))
    ) {
      return reply
        .code(400)
        .send(
          errorResponse(
            new ServiceError('VALIDATION_ERROR', 400, false),
            ports,
          ),
        );
    }
    app.log.error({ diagnosticId: diagnosticId(ports) }, 'request failed');
    return reply
      .code(500)
      .send(
        errorResponse(new ServiceError('INTERNAL_ERROR', 500, true), ports),
      );
  });
}

function compositeRateLimitKey(
  config: ServerConfig,
  request: FastifyRequest,
): string {
  const body = request.body;
  const installationId =
    typeof body === 'object' &&
    body !== null &&
    'client' in body &&
    typeof body.client === 'object' &&
    body.client !== null &&
    'installationId' in body.client &&
    typeof body.client.installationId === 'string'
      ? body.client.installationId
      : 'anonymous-installation';
  return createHmac('sha256', config.rateLimitHmacSecret)
    .update(`${request.ip}:${installationId}`)
    .digest('base64url');
}

export function registerRoomRoutes(
  app: FastifyInstance,
  service: RoomService,
  config: ServerConfig,
): void {
  const commonErrorResponses = {
    400: ErrorResponseSchema,
    401: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    410: ErrorResponseSchema,
    426: ErrorResponseSchema,
    429: ErrorResponseSchema,
    500: ErrorResponseSchema,
  };
  const routeRateLimit = {
    max: config.joinRateLimitMax,
    timeWindow: 60_000,
    keyGenerator: (request: FastifyRequest) =>
      compositeRateLimitKey(config, request),
  };

  app.post<{
    Body: CreateRoomRequest;
    Headers: { 'idempotency-key': string; 'x-protocol-version': '1' };
  }>(
    '/v1/rooms',
    {
      config: { rateLimit: routeRateLimit },
      schema: {
        body: CreateRoomRequestSchema,
        headers: idempotencyHeadersSchema,
        response: { 201: SessionBootstrapSchema, ...commonErrorResponses },
      },
    },
    async (request, reply) => {
      const result = await service.createRoom(
        request.headers['idempotency-key'],
        request.body,
      );
      return reply.code(201).send(result.body);
    },
  );

  app.post<{
    Body: JoinRoomRequest;
    Params: { roomCode: string };
    Headers: { 'idempotency-key': string; 'x-protocol-version': '1' };
  }>(
    '/v1/rooms/:roomCode/players',
    {
      config: { rateLimit: routeRateLimit },
      schema: {
        body: JoinRoomRequestSchema,
        params: roomCodeParamsSchema,
        headers: idempotencyHeadersSchema,
        response: { 201: SessionBootstrapSchema, ...commonErrorResponses },
      },
    },
    async (request, reply) => {
      const result = await service.joinRoom(
        request.headers['idempotency-key'],
        request.params.roomCode,
        request.body,
      );
      return reply.code(201).send(result.body);
    },
  );

  app.post<{
    Body: ResumeSessionRequest;
    Headers: {
      authorization: string;
      'idempotency-key': string;
      'x-protocol-version': '1';
    };
  }>(
    '/v1/sessions/resume',
    {
      schema: {
        body: ResumeSessionRequestSchema,
        headers: authenticatedIdempotencyHeadersSchema,
        response: { 200: SessionBootstrapSchema, ...commonErrorResponses },
      },
    },
    async (request, reply) => {
      const result = await service.resumeSession(
        request.headers['idempotency-key'],
        bearerToken(request.headers.authorization),
        request.body,
      );
      return reply.code(200).send(result.body);
    },
  );

  app.get<{
    Headers: { authorization: string; 'x-protocol-version': '1' };
  }>(
    '/v1/rooms/current/view',
    {
      schema: {
        headers: authenticatedHeadersSchema,
        response: { 200: ReadRoomViewResponseSchema, ...commonErrorResponses },
      },
    },
    async (request, reply) =>
      reply
        .code(200)
        .send(
          await service.readCurrentView(
            bearerToken(request.headers.authorization),
          ),
        ),
  );
}

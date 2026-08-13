import { createHmac } from 'node:crypto';

import rateLimit from '@fastify/rate-limit';
import { Type } from '@sinclair/typebox';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { Server as SocketIoServer } from 'socket.io';

import { RealtimeAuthSchema, createProtocolValidator } from '@avalon/protocol';

import type { ServerConfig } from './config.js';
import type { DependencyChecks } from './dependencies.js';
import { createLoggerOptions } from './observability.js';

const healthSchema = Type.Object(
  { status: Type.Union([Type.Literal('ok'), Type.Literal('ready')]) },
  { additionalProperties: false },
);
const notReadySchema = Type.Object(
  { status: Type.Literal('not_ready') },
  { additionalProperties: false },
);

export interface AvalonServer {
  readonly app: FastifyInstance;
  readonly io: SocketIoServer;
  close(): Promise<void>;
}

export async function createServer(
  config: ServerConfig,
  dependencies: DependencyChecks,
): Promise<AvalonServer> {
  const app = Fastify({
    bodyLimit: 32 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
    logger: createLoggerOptions(config),
    trustProxy: config.nodeEnv === 'production',
  });

  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: 60_000,
    keyGenerator: (request) =>
      createHmac('sha256', config.rateLimitHmacSecret)
        .update(request.ip)
        .digest('base64url'),
  });

  app.addHook('onSend', (_request, reply, payload, done) => {
    void reply.header('Cache-Control', 'no-store');
    void reply.header('X-Content-Type-Options', 'nosniff');
    done(null, payload);
  });

  app.get(
    '/v1/health/live',
    { schema: { response: { 200: healthSchema } } },
    () => ({ status: 'ok' as const }),
  );

  app.get(
    '/v1/health/ready',
    {
      schema: {
        response: { 200: healthSchema, 503: notReadySchema },
      },
    },
    async (_request, reply) => {
      try {
        await Promise.all([
          dependencies.checkPostgres(),
          dependencies.checkRedis(),
        ]);
        return { status: 'ready' as const };
      } catch {
        return reply.code(503).send({ status: 'not_ready' as const });
      }
    },
  );

  const io = new SocketIoServer(app.server, {
    maxHttpBufferSize: 64 * 1024,
    serveClient: false,
  });
  const protocolValidator = createProtocolValidator();
  const validateRealtimeAuth = protocolValidator.compile(RealtimeAuthSchema);
  const gameNamespace = io.of('/game-v1');

  gameNamespace.use((socket, next) => {
    if (!validateRealtimeAuth(socket.handshake.auth)) {
      next(new Error('UNAUTHORIZED'));
      return;
    }
    next(new Error('UNAUTHORIZED'));
  });

  return {
    app,
    io,
    async close() {
      await io.close();
      await Promise.all([app.close(), dependencies.close()]);
    },
  };
}

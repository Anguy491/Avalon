import { createHmac } from 'node:crypto';

import rateLimit from '@fastify/rate-limit';
import { Type } from '@sinclair/typebox';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { Server as SocketIoServer } from 'socket.io';

import { CommandService } from './command-service.js';
import { ConnectionService } from './connection-service.js';
import type { ServerConfig } from './config.js';
import {
  isRuntimeDependencies,
  type DependencyChecks,
} from './dependencies.js';
import { installSafeErrorHandler, registerRoomRoutes } from './http-routes.js';
import { createLoggerOptions } from './observability.js';
import { OutboxWorker } from './outbox-worker.js';
import { RedisProjectionBus } from './projection-bus.js';
import { createRedisRateLimitStore } from './rate-limit-store.js';
import { registerRealtime } from './realtime.js';
import { RoomService, ServiceError } from './room-service.js';
import { createRuntimePorts, type RuntimePorts } from './runtime-ports.js';
import { RedisSessionPresence } from './session-presence.js';

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

export interface CreateServerOptions {
  readonly ports?: RuntimePorts;
  readonly startBackgroundWorkers?: boolean;
}

export async function createServer(
  config: ServerConfig,
  dependencies: DependencyChecks,
  options: CreateServerOptions = {},
): Promise<AvalonServer> {
  const ports = options.ports ?? createRuntimePorts();
  const app = Fastify({
    bodyLimit: 32 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
    logger: createLoggerOptions(config),
    trustProxy: config.nodeEnv === 'production',
  });

  await app.register(rateLimit, {
    global: true,
    hook: 'preHandler',
    max: config.rateLimitMax,
    timeWindow: 60_000,
    keyGenerator: (request) =>
      createHmac('sha256', config.rateLimitHmacSecret)
        .update(request.ip)
        .digest('base64url'),
    errorResponseBuilder: () => new ServiceError('RATE_LIMITED', 429, true),
    ...(isRuntimeDependencies(dependencies)
      ? { store: createRedisRateLimitStore(dependencies.redis, ports.clock) }
      : {}),
  });

  installSafeErrorHandler(app, ports);

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
  const gameNamespace = io.of('/game-v1');
  let projectionBus: RedisProjectionBus | undefined;
  let outboxWorker: OutboxWorker | undefined;
  let connectionService: ConnectionService | undefined;
  if (isRuntimeDependencies(dependencies)) {
    const roomService = new RoomService(dependencies.sql, config, ports);
    const commandService = new CommandService(dependencies.sql, config, ports);
    registerRoomRoutes(app, roomService, config);
    const presence = new RedisSessionPresence(dependencies.redis);
    connectionService = new ConnectionService(
      dependencies.sql,
      ports,
      presence,
    );
    projectionBus = new RedisProjectionBus(dependencies.redis, gameNamespace);
    await projectionBus.start();
    outboxWorker = new OutboxWorker(dependencies.sql, projectionBus, ports, {
      workerId: ports.ids.next(),
      presence,
      onTerminalCleanup: (observation) => {
        app.log.info(observation, 'terminal room data deleted');
      },
      onError: (operation) => {
        app.log.error({ operation }, 'outbox worker operation failed');
      },
    });
    registerRealtime(
      gameNamespace,
      roomService,
      commandService,
      outboxWorker,
      dependencies.redis,
      ports,
      presence,
      connectionService,
    );
    if (options.startBackgroundWorkers !== false) {
      outboxWorker.start();
      connectionService.start();
    }
  } else {
    gameNamespace.use((_socket, next) => {
      next(new Error('UNAUTHORIZED'));
    });
  }

  return {
    app,
    io,
    async close() {
      await outboxWorker?.stop();
      await connectionService?.stop();
      await io.close();
      await projectionBus?.close();
      await app.close();
      await dependencies.close();
    },
  };
}

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
import { createMetricsPort } from './metrics.js';
import { OutboxWorker } from './outbox-worker.js';
import { RedisProjectionBus } from './projection-bus.js';
import { RealtimeAdmission } from './realtime-admission.js';
import { createRedisRateLimitStore } from './rate-limit-store.js';
import { registerRealtime } from './realtime.js';
import type { RealtimeLifecycle } from './realtime.js';
import { RoomService, ServiceError } from './room-service.js';
import { createRuntimePorts, type RuntimePorts } from './runtime-ports.js';
import { RedisSessionPresence } from './session-presence.js';
import { RedisSessionRevocationBus } from './session-revocation.js';
import { TrustedProxyPolicy } from './trusted-client-ip.js';

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
  const metrics = createMetricsPort(config);
  const trustedProxies = new TrustedProxyPolicy(config.trustedProxyCidrs);
  let draining = false;
  const app = Fastify({
    bodyLimit: 32 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
    logger: createLoggerOptions(config),
    trustProxy:
      config.nodeEnv === 'production' ? [...config.trustedProxyCidrs] : false,
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

  app.addHook('onRequest', (request, _reply, done) => {
    if (request.url.startsWith('/v1/')) {
      done(new ServiceError('UPGRADE_REQUIRED', 426, false));
      return;
    }
    if (
      draining &&
      request.url !== '/v2/health/live' &&
      request.url !== '/v2/health/ready'
    ) {
      done(new ServiceError('INTERNAL_ERROR', 503, true));
      return;
    }
    done();
  });

  app.get(
    '/v2/health/live',
    { schema: { response: { 200: healthSchema } } },
    () => ({ status: 'ok' as const }),
  );

  app.get(
    '/v2/health/ready',
    {
      schema: {
        response: { 200: healthSchema, 503: notReadySchema },
      },
    },
    async (_request, reply) => {
      try {
        if (draining) throw new Error('draining');
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

  let admission: RealtimeAdmission | undefined;
  if (isRuntimeDependencies(dependencies)) {
    admission = new RealtimeAdmission(
      dependencies.redis,
      config,
      ports.ids.next(),
    );
  }
  const io = new SocketIoServer(app.server, {
    maxHttpBufferSize: 64 * 1024,
    serveClient: false,
    allowRequest: (request, callback) => {
      const currentAdmission = admission;
      const clientIp = trustedProxies.clientIp(
        request.socket.remoteAddress,
        request.headers['x-forwarded-for'],
      );
      if (
        draining ||
        currentAdmission === undefined ||
        clientIp === undefined
      ) {
        callback(null, false);
        return;
      }
      void currentAdmission
        .allowEngineHandshake(clientIp, ports.clock.now())
        .then((allowed) => {
          callback(null, allowed);
        })
        .catch(() => {
          callback(null, false);
        });
    },
  });
  const legacyGameNamespace = io.of('/game-v1');
  legacyGameNamespace.use((_socket, next) => {
    next(new Error('UPGRADE_REQUIRED'));
  });
  const gameNamespace = io.of('/game-v2');
  let projectionBus: RedisProjectionBus | undefined;
  let outboxWorker: OutboxWorker | undefined;
  let connectionService: ConnectionService | undefined;
  let revocationBus: RedisSessionRevocationBus | undefined;
  let realtimeLifecycle: RealtimeLifecycle | undefined;
  if (isRuntimeDependencies(dependencies)) {
    if (admission === undefined) {
      throw new Error('Realtime admission was not initialized');
    }
    revocationBus = new RedisSessionRevocationBus(
      dependencies.redis,
      gameNamespace,
      ports,
    );
    await revocationBus.start();
    const roomService = new RoomService(
      dependencies.sql,
      config,
      ports,
      revocationBus,
    );
    const commandService = new CommandService(dependencies.sql, config, ports);
    registerRoomRoutes(
      app,
      roomService,
      config,
      dependencies.redis,
      ports,
      metrics,
    );
    const presence = new RedisSessionPresence(dependencies.redis);
    connectionService = new ConnectionService(
      dependencies.sql,
      ports,
      presence,
    );
    projectionBus = new RedisProjectionBus(
      dependencies.redis,
      gameNamespace,
      () => {
        metrics.recordProjectionRecipientMismatch();
      },
    );
    await projectionBus.start();
    outboxWorker = new OutboxWorker(dependencies.sql, projectionBus, ports, {
      workerId: ports.ids.next(),
      batchSize: config.outboxBatchSize,
      presence,
      onTerminalCleanup: (observation) => {
        metrics.recordTerminalCleanup(observation.delayMs, observation.trigger);
        app.log.info(observation, 'terminal room data deleted');
      },
      onOutboxAge: (ageMs) => {
        metrics.recordOutboxAge(ageMs);
      },
      onProjection: (durationMs, outcome) => {
        metrics.recordProjection(durationMs, outcome);
      },
      onGameEnd: (reason) => {
        metrics.recordGameEnd(reason);
      },
      onPause: () => {
        metrics.recordPause();
      },
      onError: (operation) => {
        app.log.error({ operation }, 'outbox worker operation failed');
      },
    });
    realtimeLifecycle = registerRealtime(
      gameNamespace,
      roomService,
      commandService,
      outboxWorker,
      dependencies.redis,
      ports,
      presence,
      connectionService,
      config,
      admission,
      metrics,
      trustedProxies,
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
      if (draining) return;
      draining = true;
      gameNamespace.emit('server.maintenance', {
        protocolVersion: 2,
        startsAt: ports.clock.now().toISOString(),
        retryAfterMs: 30_000,
        diagnosticId: `diag_${ports.ids.next()}`,
      });
      let timeout: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.all([
          outboxWorker?.stop(),
          connectionService?.stop(),
          realtimeLifecycle?.stopAcceptingAndWait(),
        ]),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 30_000);
        }),
      ]).finally(() => {
        if (timeout !== undefined) clearTimeout(timeout);
      });
      await io.close();
      await projectionBus?.close();
      await revocationBus?.close();
      await metrics.shutdown();
      await app.close();
      await dependencies.close();
    },
  };
}

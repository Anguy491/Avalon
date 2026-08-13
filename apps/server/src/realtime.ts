import type { Namespace, Socket } from 'socket.io';
import type { RedisClientType } from 'redis';

import {
  CommandSchema,
  RealtimeAuthSchema,
  TerminalViewAckSchema,
  createProtocolValidator,
  type Command,
  type CommandResult,
  type RealtimeAuth,
  type TerminalViewAck,
} from '@avalon/protocol';

import type { CommandService } from './command-service.js';
import type { OutboxWorker } from './outbox-worker.js';
import { sessionSocketRoom } from './projection-bus.js';
import type { RoomService } from './room-service.js';
import type { RuntimePorts } from './runtime-ports.js';
import type { SessionContext } from './session-context.js';

const INVALID_COMMAND_ID = '00000000-0000-4000-8000-000000000000';

interface SocketData {
  readonly session: SessionContext;
}

interface ClientToServerEvents {
  'command.submit': (
    payload: unknown,
    ack?: (result: CommandResult) => void,
  ) => void;
  'room.terminalAck': (
    payload: unknown,
    ack?: (result: { readonly accepted: boolean }) => void,
  ) => void;
  'session.ping': (
    payload: unknown,
    ack?: (result: { readonly serverTime: string }) => void,
  ) => void;
}

interface ServerToClientEvents {
  'session.ready': (payload: unknown) => void;
}

type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

function diagnosticId(ports: RuntimePorts): string {
  return `diag_${ports.ids.next()}`;
}

function rejected(
  commandId: string,
  code: 'VALIDATION_ERROR' | 'RATE_LIMITED' | 'INTERNAL_ERROR',
  ports: RuntimePorts,
  retryable = false,
): CommandResult {
  return {
    commandId,
    accepted: false,
    error: {
      code,
      diagnosticId: diagnosticId(ports),
      retryable,
    },
  };
}

function candidateCommandId(payload: unknown): string {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'commandId' in payload &&
    typeof payload.commandId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payload.commandId,
    )
  ) {
    return payload.commandId;
  }
  return INVALID_COMMAND_ID;
}

async function withinCommandRate(
  redis: RedisClientType,
  sessionId: string,
  now: Date,
): Promise<boolean> {
  if (!redis.isOpen) await redis.connect();
  const second = Math.floor(now.getTime() / 1_000);
  const burstKey = `avalon:command-rate:burst:${sessionId}:${String(second)}`;
  const sustainedKey = `avalon:command-rate:sustained:${sessionId}:${String(
    Math.floor(second / 5),
  )}`;
  const results = await redis
    .multi()
    .incr(burstKey)
    .expire(burstKey, 2)
    .incr(sustainedKey)
    .expire(sustainedKey, 6)
    .exec();
  const burst = Number(results[0]);
  const sustained = Number(results[2]);
  return burst <= 10 && sustained <= 10;
}

export function registerRealtime(
  namespace: Namespace,
  roomService: RoomService,
  commandService: CommandService,
  outboxWorker: OutboxWorker,
  redis: RedisClientType,
  ports: RuntimePorts,
): void {
  const validator = createProtocolValidator();
  const validateAuth = validator.compile(RealtimeAuthSchema);
  const validateCommand = validator.compile(CommandSchema);
  const validateTerminalAck = validator.compile(TerminalViewAckSchema);

  const authenticateSocket = async (
    untypedSocket: Socket,
    next: (error?: Error) => void,
  ): Promise<void> => {
    try {
      if (!validateAuth(untypedSocket.handshake.auth)) {
        next(new Error('UNAUTHORIZED'));
        return;
      }
      const auth = untypedSocket.handshake.auth as RealtimeAuth;
      const session = await roomService.authenticate(auth.sessionToken);
      (untypedSocket as unknown as GameSocket).data = { session };
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  };

  namespace.use((socket, next) => {
    void authenticateSocket(socket, next);
  });

  namespace.on('connection', (untypedSocket) => {
    const socket = untypedSocket as unknown as GameSocket;
    const context = socket.data.session;
    void socket.join(sessionSocketRoom(context.sessionId));
    void roomService
      .readViewForSession(context, 'RESYNC')
      .then((roomView) => {
        socket.emit('session.ready', {
          protocolVersion: 1,
          delivery: 'RESYNC',
          roomView,
        });
      })
      .catch(() => {
        socket.disconnect(true);
      });

    socket.on(
      'command.submit',
      async (payload: unknown, ack?: (result: CommandResult) => void) => {
        const commandId = candidateCommandId(payload);
        if (!validateCommand(payload)) {
          ack?.(rejected(commandId, 'VALIDATION_ERROR', ports));
          return;
        }
        try {
          if (
            !(await withinCommandRate(
              redis,
              context.sessionId,
              ports.clock.now(),
            ))
          ) {
            ack?.(rejected(commandId, 'RATE_LIMITED', ports, true));
            return;
          }
          ack?.(await commandService.submit(context, payload as Command));
        } catch {
          ack?.(rejected(commandId, 'INTERNAL_ERROR', ports, true));
        }
      },
    );

    socket.on(
      'room.terminalAck',
      async (
        payload: unknown,
        ack?: (result: { readonly accepted: boolean }) => void,
      ) => {
        if (!validateTerminalAck(payload)) {
          ack?.({ accepted: false });
          return;
        }
        const terminalAck = payload as TerminalViewAck;
        ack?.({
          accepted: await outboxWorker.acknowledgeTerminal(
            context,
            terminalAck.stateVersion,
          ),
        });
      },
    );

    socket.on(
      'session.ping',
      (
        _payload: unknown,
        ack?: (result: { readonly serverTime: string }) => void,
      ) => {
        ack?.({ serverTime: ports.clock.now().toISOString() });
      },
    );
  });
}

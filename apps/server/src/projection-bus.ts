import type { Namespace } from 'socket.io';
import type { RedisClientType } from 'redis';

import {
  RoomViewMessageSchema,
  createProtocolValidator,
  type RoomViewMessage,
} from '@avalon/protocol';

import type {
  ProjectionDelivery,
  ProjectionPublisher,
} from './outbox-worker.js';
import type { SessionContext } from './session-context.js';

const CHANNEL = 'avalon:m2:personalized-projections';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validateRoomViewMessage = createProtocolValidator().compile(
  RoomViewMessageSchema,
);

interface SocketData {
  readonly session?: SessionContext;
}

export function parseProjectionDelivery(
  serialized: string,
): ProjectionDelivery | undefined {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.sessionId !== 'string' ||
    typeof candidate.playerId !== 'string' ||
    typeof candidate.roomId !== 'string' ||
    typeof candidate.eventId !== 'string' ||
    !UUID_PATTERN.test(candidate.sessionId) ||
    !UUID_PATTERN.test(candidate.playerId) ||
    !UUID_PATTERN.test(candidate.roomId) ||
    !UUID_PATTERN.test(candidate.eventId) ||
    !validateRoomViewMessage(candidate.message)
  ) {
    return undefined;
  }
  const message = candidate.message as RoomViewMessage;
  if (
    message.eventId !== candidate.eventId ||
    message.roomView.public.roomId !== candidate.roomId ||
    message.roomView.private.playerId !== candidate.playerId
  ) {
    return undefined;
  }
  return candidate as unknown as ProjectionDelivery;
}

export function sessionSocketRoom(sessionId: string): string {
  return `session:${sessionId}`;
}

export class RedisProjectionBus implements ProjectionPublisher {
  private readonly subscriber: ReturnType<RedisClientType['duplicate']>;
  private started = false;

  constructor(
    private readonly publisher: RedisClientType,
    private readonly namespace: Namespace,
  ) {
    this.subscriber = publisher.duplicate();
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (!this.publisher.isOpen) await this.publisher.connect();
    if (!this.subscriber.isOpen) await this.subscriber.connect();
    await this.subscriber.subscribe(CHANNEL, (serialized) => {
      const delivery = parseProjectionDelivery(serialized);
      if (delivery === undefined) return;
      const targetRoom = sessionSocketRoom(delivery.sessionId);
      for (const socket of this.namespace.sockets.values()) {
        const context = (socket.data as SocketData).session;
        if (
          socket.rooms.has(targetRoom) &&
          context?.sessionId === delivery.sessionId &&
          context.roomId === delivery.roomId &&
          context.playerId === delivery.playerId
        ) {
          socket.emit('room.view', delivery.message);
        }
      }
    });
    this.started = true;
  }

  async publish(delivery: ProjectionDelivery): Promise<void> {
    if (!this.started) await this.start();
    await this.publisher.publish(CHANNEL, JSON.stringify(delivery));
  }

  async close(): Promise<void> {
    if (!this.started) return;
    await this.subscriber.unsubscribe(CHANNEL);
    await this.subscriber.quit();
    this.started = false;
  }
}

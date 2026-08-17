import type { Namespace } from 'socket.io';
import type { RedisClientType } from 'redis';

import type { SessionRotationPublisher } from './room-service.js';
import type { RuntimePorts } from './runtime-ports.js';
import type { SessionContext } from './session-context.js';

const CHANNEL = 'avalon:m7:session-rotations';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface SessionRotation {
  readonly sessionId: string;
  readonly credentialGeneration: number;
}

interface SocketData {
  readonly session?: SessionContext;
}

export function parseSessionRotation(
  serialized: string,
): SessionRotation | undefined {
  try {
    const value = JSON.parse(serialized) as Partial<SessionRotation> &
      Record<string, unknown>;
    if (
      Object.keys(value).some(
        (key) => key !== 'sessionId' && key !== 'credentialGeneration',
      ) ||
      typeof value.sessionId !== 'string' ||
      !UUID_PATTERN.test(value.sessionId) ||
      !Number.isSafeInteger(value.credentialGeneration) ||
      (value.credentialGeneration ?? 0) < 1
    ) {
      return undefined;
    }
    return value as SessionRotation;
  } catch {
    return undefined;
  }
}

export class RedisSessionRevocationBus implements SessionRotationPublisher {
  private readonly subscriber: ReturnType<RedisClientType['duplicate']>;
  private started = false;

  constructor(
    private readonly publisher: RedisClientType,
    private readonly namespace: Namespace,
    private readonly ports: RuntimePorts,
  ) {
    this.subscriber = publisher.duplicate();
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (!this.publisher.isOpen) await this.publisher.connect();
    if (!this.subscriber.isOpen) await this.subscriber.connect();
    await this.subscriber.subscribe(CHANNEL, (serialized) => {
      const rotation = parseSessionRotation(serialized);
      if (rotation === undefined) return;
      for (const socket of this.namespace.sockets.values()) {
        const context = (socket.data as SocketData).session;
        if (
          context?.sessionId !== rotation.sessionId ||
          context.credentialGeneration >= rotation.credentialGeneration
        ) {
          continue;
        }
        socket.emit('session.revoked', {
          protocolVersion: 2,
          reason: 'SESSION_REPLACED',
          diagnosticId: `diag_${this.ports.ids.next()}`,
        });
        socket.disconnect(true);
      }
    });
    this.started = true;
  }

  async publishSessionRotation(rotation: SessionRotation): Promise<void> {
    if (!this.started) await this.start();
    await this.publisher.publish(CHANNEL, JSON.stringify(rotation));
  }

  async close(): Promise<void> {
    if (!this.started) return;
    await this.subscriber.unsubscribe(CHANNEL);
    await this.subscriber.quit();
    this.started = false;
  }
}

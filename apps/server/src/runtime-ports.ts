import { randomBytes, randomUUID } from 'node:crypto';

export interface ClockPort {
  now(): Date;
}

export interface IdPort {
  next(): string;
}

export interface RandomPort {
  bytes(length: number): Uint8Array;
}

export interface RuntimePorts {
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly random: RandomPort;
}

export function createRuntimePorts(): RuntimePorts {
  return {
    clock: { now: () => new Date() },
    ids: { next: () => randomUUID() },
    random: { bytes: (length) => randomBytes(length) },
  };
}

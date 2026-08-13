/**
 * Ports that keep the future RULE-* / SM-* implementation deterministic.
 * M1 will add state transitions; M0 only establishes the dependency boundary.
 */
export interface ClockPort {
  now(): Date;
}

export interface IdGeneratorPort {
  nextId(): string;
}

export interface RandomBytesPort {
  bytes(length: number): Uint8Array;
}

export const GAME_ENGINE_MILESTONE = 'M0_BOUNDARY_ONLY' as const;

import { describe, expect, it } from 'vitest';

import { GAME_ENGINE_MILESTONE, type RandomBytesPort } from './index.js';

describe('M0-004 game-engine boundary', () => {
  it('exposes injectable deterministic ports without I/O dependencies', () => {
    const random: RandomBytesPort = {
      bytes: (length) => new Uint8Array(length).fill(7),
    };

    expect(GAME_ENGINE_MILESTONE).toBe('M0_BOUNDARY_ONLY');
    expect([...random.bytes(3)]).toEqual([7, 7, 7]);
  });
});

import { describe, expect, it } from 'vitest';

import {
  IdempotencyKeys,
  nicknameError,
  nicknameErrorCode,
  normalizeRoomCode,
  parseJoinLink,
} from './index.js';

describe('client core', () => {
  it('reuses an idempotency key for the same pending request', () => {
    const keys = new IdempotencyKeys();
    expect(keys.acquire('same', () => 'first')).toBe('first');
    expect(keys.acquire('same', () => 'second')).toBe('first');
    keys.complete('same');
    expect(keys.acquire('same', () => 'third')).toBe('third');
  });

  it('normalizes public room codes and rejects external QR links', () => {
    expect(normalizeRoomCode('7k-3m9q')).toBe('7K3M9Q');
    expect(
      parseJoinLink('https://avalon.example/join/7K3M9Q', ['avalon.example']),
    ).toBe('7K3M9Q');
    expect(
      parseJoinLink('https://evil.example/join/7K3M9Q', ['avalon.example']),
    ).toBeUndefined();
  });

  it('rejects empty and control-character nicknames', () => {
    expect(nicknameErrorCode('')).toBe('INVALID_LENGTH');
    expect(nicknameErrorCode('玩家\u202e')).toBe('CONTROL_CHARACTER');
    expect(nicknameErrorCode('玩家一号')).toBeUndefined();
    expect(nicknameError('')).toBeDefined();
    expect(nicknameError('玩家\u202e')).toBeDefined();
    expect(nicknameError('玩家一号')).toBeUndefined();
  });
});

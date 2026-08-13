import { describe, expect, it } from 'vitest';

import { normalizeRoomCode, parseJoinLink } from './room-code';

describe('FR-004 / AC-013 room codes and QR allowlist', () => {
  it('normalizes one six-character input value', () => {
    expect(normalizeRoomCode(' 7k3-m9q ')).toBe('7K3M9Q');
  });

  it('accepts only the controlled HTTPS host and exact join path', () => {
    expect(
      parseJoinLink('https://join.example.invalid/join/7k3m9q', [
        'join.example.invalid',
      ]),
    ).toBe('7K3M9Q');
    for (const unsafe of [
      'http://join.example.invalid/join/7K3M9Q',
      'https://evil.invalid/join/7K3M9Q',
      'https://join.example.invalid/join/7K3M9Q?sessionToken=secret',
      'https://join.example.invalid/redirect/https://evil.invalid',
      'javascript:alert(1)',
    ]) {
      expect(parseJoinLink(unsafe, ['join.example.invalid'])).toBeUndefined();
    }
  });
});

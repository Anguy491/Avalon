import { describe, expect, it } from 'vitest';

import { formatUuidV4 } from './uuid-format';

describe('formatUuidV4', () => {
  it('sets the RFC 4122 version and variant bits', () => {
    expect(formatUuidV4(new Uint8Array(16))).toBe(
      '00000000-0000-4000-8000-000000000000',
    );
  });

  it('rejects a malformed secure-random result', () => {
    expect(() => formatUuidV4(new Uint8Array(15))).toThrow('exactly 16 bytes');
  });
});

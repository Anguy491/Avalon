import { describe, expect, it } from 'vitest';

import { parseSessionRotation } from './session-revocation.js';

describe('M7 credential-generation revocation envelope', () => {
  it('accepts only bounded internal rotation messages', () => {
    const valid = {
      sessionId: '10000000-0000-4000-8000-000000000001',
      credentialGeneration: 2,
    };
    expect(parseSessionRotation(JSON.stringify(valid))).toEqual(valid);
    expect(
      parseSessionRotation(
        JSON.stringify({ ...valid, credentialGeneration: 0 }),
      ),
    ).toBeUndefined();
    expect(
      parseSessionRotation(JSON.stringify({ ...valid, role: 'MERLIN' })),
    ).toBeUndefined();
    expect(parseSessionRotation('{')).toBeUndefined();
  });
});

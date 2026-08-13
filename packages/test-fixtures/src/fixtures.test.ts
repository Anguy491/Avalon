import { describe, expect, it } from 'vitest';

import { FIXTURE_NICKNAMES, FIXTURE_PLAYER_IDS } from './index.js';

describe('M0-004 deterministic fixtures', () => {
  it('keeps public fixture identities stable and non-secret', () => {
    expect(FIXTURE_PLAYER_IDS).toHaveLength(5);
    expect(new Set(FIXTURE_NICKNAMES).size).toBe(5);
  });
});

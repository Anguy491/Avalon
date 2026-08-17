import { describe, expect, it } from 'vitest';

import { ROLE_GUIDES, roleGuideFor } from './role-guide-content';

describe('role guide content', () => {
  it('covers every supported role with non-empty private guidance', () => {
    expect(Object.keys(ROLE_GUIDES).sort()).toEqual(
      [
        'ASSASSIN',
        'LOYAL_SERVANT',
        'MERLIN',
        'MINION',
        'MORDRED',
        'MORGANA',
        'OBERON',
        'PERCIVAL',
      ].sort(),
    );
    for (const guide of Object.values(ROLE_GUIDES)) {
      expect(guide.title.length).toBeGreaterThan(0);
      expect(guide.summary.length).toBeGreaterThan(0);
      expect(guide.tips.length).toBeGreaterThan(0);
    }
  });

  it('returns no content when the private role projection is absent', () => {
    expect(roleGuideFor(undefined)).toBeUndefined();
    expect(roleGuideFor(null)).toBeUndefined();
    expect(roleGuideFor('MERLIN')).toBe(ROLE_GUIDES.MERLIN);
  });
});

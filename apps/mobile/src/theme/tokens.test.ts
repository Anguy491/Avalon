import { describe, expect, it } from 'vitest';

import { color, touchTarget, typography } from './tokens';

describe('UX section 3 semantic tokens', () => {
  it('keeps public, private, and blocking surfaces semantically distinct', () => {
    expect(new Set(Object.values(color.surface)).size).toBe(
      Object.values(color.surface).length,
    );
  });

  it('meets the M0 typography and touch-target floors', () => {
    expect(typography.body).toBeGreaterThanOrEqual(16);
    expect(typography.supporting).toBeGreaterThanOrEqual(13);
    expect(touchTarget.minimum).toBeGreaterThanOrEqual(44);
  });
});

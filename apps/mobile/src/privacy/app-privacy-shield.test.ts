import { describe, expect, it } from 'vitest';

import { isPrivateSnapshotState } from './privacy-state';

describe('FR-020 application-switcher privacy shield', () => {
  it('covers inactive, background, extension, and unknown states', () => {
    expect(isPrivateSnapshotState('active')).toBe(false);
    expect(isPrivateSnapshotState('inactive')).toBe(true);
    expect(isPrivateSnapshotState('background')).toBe(true);
    expect(isPrivateSnapshotState('extension')).toBe(true);
    expect(isPrivateSnapshotState('unknown')).toBe(true);
  });
});

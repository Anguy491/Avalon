import { describe, expect, it } from 'vitest';

import { rememberPlaybackId } from './playback-history';

describe('FR-038 audio playback deduplication', () => {
  it('keeps only the most recent 64 unique cue ids', () => {
    let ids: readonly string[] = [];
    for (let index = 0; index < 70; index += 1) {
      ids = rememberPlaybackId(ids, `cue-${String(index)}`);
    }
    expect(ids).toHaveLength(64);
    expect(ids[0]).toBe('cue-6');
    expect(rememberPlaybackId(ids, 'cue-69')).toBe(ids);
  });
});

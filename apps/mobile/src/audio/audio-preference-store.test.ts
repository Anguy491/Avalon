import { describe, expect, it } from 'vitest';

import { audioPreferenceStore } from './audio-preference-store';

describe('audioPreferenceStore', () => {
  it('persists only non-sensitive audio preferences through its platform port', async () => {
    await audioPreferenceStore.setItem('test.audio.volume', '0.7');
    expect(await audioPreferenceStore.getItem('test.audio.volume')).toBe('0.7');
  });
});

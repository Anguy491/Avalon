import { describe, expect, it } from 'vitest';

import { AUDIO_SUBTITLE_KEYS } from '../audio/audio-subtitles';
import voicePackManifest from '../../assets/audio/zh-CN-v1/manifest.json';

import { enMessages, zhCNMessages } from './messages';

describe('AC-020 translation catalog', () => {
  it('keeps English and Simplified Chinese keys complete and non-empty', () => {
    expect(Object.keys(enMessages).sort()).toEqual(
      Object.keys(zhCNMessages).sort(),
    );
    for (const catalog of [enMessages, zhCNMessages] as readonly Readonly<
      Record<string, string | Readonly<{ one: string; other: string }>>
    >[]) {
      for (const value of Object.values(catalog)) {
        if (typeof value === 'string') expect(value.trim()).not.toBe('');
        else {
          expect(value.one.trim()).not.toBe('');
          expect(value.other.trim()).not.toBe('');
        }
      }
    }
  });

  it('keeps interpolation parameters aligned between catalogs', () => {
    const parameters = (value: string) =>
      [...value.matchAll(/%\{([^}]+)\}/gu)].map((match) => match[1]).sort();
    for (const key of Object.keys(
      zhCNMessages,
    ) as (keyof typeof zhCNMessages)[]) {
      const chinese = zhCNMessages[key];
      const english = enMessages[key];
      if (typeof chinese === 'string' && typeof english === 'string') {
        expect(parameters(english), key).toEqual(parameters(chinese));
      } else if (typeof chinese !== 'string' && typeof english !== 'string') {
        expect(parameters(english.one), `${key}.one`).toEqual(
          parameters(chinese.one),
        );
        expect(parameters(english.other), `${key}.other`).toEqual(
          parameters(chinese.other),
        );
      } else {
        throw new Error(`Plural shape differs for ${key}`);
      }
    }
  });

  it('covers every approved voice cue and preserves its Chinese transcript', () => {
    expect(Object.keys(AUDIO_SUBTITLE_KEYS).sort()).toEqual(
      voicePackManifest.entries.map((entry) => entry.key).sort(),
    );
    for (const entry of voicePackManifest.entries) {
      const messageKey =
        AUDIO_SUBTITLE_KEYS[entry.key as keyof typeof AUDIO_SUBTITLE_KEYS];
      expect(zhCNMessages[messageKey]).toBe(entry.subtitle);
      expect(enMessages[messageKey]).not.toBe(entry.subtitle);
    }
  });
});

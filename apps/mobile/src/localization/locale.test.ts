import { describe, expect, it } from 'vitest';

import { resolveAppLocale } from './locale';

describe('AC-020 system locale resolution', () => {
  it.each([
    [['zh-CN'], 'zh-CN'],
    [['zh-TW'], 'zh-CN'],
    [['en-US'], 'en'],
    [['en-GB'], 'en'],
    [['fr-FR', 'zh-HK', 'en-US'], 'zh-CN'],
    [['ja-JP', 'en-AU', 'zh-CN'], 'en'],
    [['de-DE'], 'en'],
  ] as const)('resolves %j to %s', (languageTags, expected) => {
    expect(
      resolveAppLocale(
        languageTags.map((languageTag) => ({
          languageCode: languageTag.split('-')[0] ?? null,
        })),
      ),
    ).toBe(expected);
  });
});

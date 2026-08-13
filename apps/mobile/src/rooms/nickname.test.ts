import { describe, expect, it } from 'vitest';

import {
  countNicknameGraphemes,
  countNicknameGraphemesFallback,
  nicknameError,
  normalizeNickname,
} from './nickname';

describe('nickname validation', () => {
  it('normalizes NFC and surrounding whitespace', () => {
    expect(normalizeNickname('  e\u0301  ')).toBe('é');
    expect(nicknameError('  玩家  ')).toBeUndefined();
  });

  it('counts graphemes and rejects control or bidi characters', () => {
    expect(nicknameError('😀'.repeat(16))).toBeUndefined();
    expect(nicknameError('😀'.repeat(17))).toBeDefined();
    expect(nicknameError('玩家\u202E')).toBe('昵称不能包含控制字符。');
  });

  it('keeps combining marks, emoji modifiers, and flags together', () => {
    expect(countNicknameGraphemes('e\u0301👍🏽🇦🇺')).toBe(3);
    expect(countNicknameGraphemesFallback('e\u0301👍🏽🇦🇺')).toBe(3);
  });
});

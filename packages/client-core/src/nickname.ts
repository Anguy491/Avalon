const BIDI_OR_CONTROL = /[\p{Cc}\p{Cf}]/u;
const COMBINING_OR_EMOJI_MODIFIER = /[\p{M}\u{1F3FB}-\u{1F3FF}]/u;
const REGIONAL_INDICATOR = /[\u{1F1E6}-\u{1F1FF}]/u;

export function normalizeNickname(value: string): string {
  return value.normalize('NFC').trim();
}

export function countNicknameGraphemesFallback(value: string): number {
  let count = 0;
  let unmatchedRegionalIndicator = false;
  for (const character of value) {
    if (COMBINING_OR_EMOJI_MODIFIER.test(character)) continue;
    if (REGIONAL_INDICATOR.test(character)) {
      if (!unmatchedRegionalIndicator) count += 1;
      unmatchedRegionalIndicator = !unmatchedRegionalIndicator;
      continue;
    }
    unmatchedRegionalIndicator = false;
    count += 1;
  }
  return count;
}

export function countNicknameGraphemes(value: string): number {
  if (typeof Intl.Segmenter === 'function') {
    return [
      ...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(
        value,
      ),
    ].length;
  }
  return countNicknameGraphemesFallback(value);
}

export function nicknameError(value: string): string | undefined {
  if (BIDI_OR_CONTROL.test(value)) return '昵称不能包含控制字符。';
  const normalized = normalizeNickname(value);
  const length = countNicknameGraphemes(normalized);
  return length >= 1 && length <= 16 ? undefined : '昵称需为 1–16 个可见字符。';
}

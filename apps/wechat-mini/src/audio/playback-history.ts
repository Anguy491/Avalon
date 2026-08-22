const MAX_PLAYBACK_IDS = 64;

export function rememberPlaybackId(
  current: readonly string[],
  audioCueId: string,
): readonly string[] {
  if (current.includes(audioCueId)) return current;
  return [...current, audioCueId].slice(-MAX_PLAYBACK_IDS);
}

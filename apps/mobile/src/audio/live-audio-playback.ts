import type { AudioSource } from 'expo-audio';

import type { RoomView, RoomViewMessage } from '@avalon/protocol/mobile';

export type AudioCueView = NonNullable<RoomView['public']['currentAudioCue']>;

export interface AudioPlayerPort {
  replace(source: AudioSource): void;
  play(): void;
}

export type AudioPlaybackErrorCategory =
  | 'ASSET_MISSING'
  | 'HASH_MISMATCH'
  | 'LOAD_FAILED';

interface RequestLiveAudioPlaybackOptions {
  readonly cue: AudioCueView;
  readonly expectedVoicePackVersion: string;
  readonly playedCueIds: Set<string>;
  readonly player: AudioPlayerPort;
  readonly reportError: (category: AudioPlaybackErrorCategory) => void;
  readonly sourceFor: (audioCueKey: string) => AudioSource | undefined;
}

/**
 * Audio is a LIVE delivery side effect, not room state. Keeping this selector
 * on the transport envelope prevents an equal-version HTTP RESYNC from
 * suppressing (or replaying) a cue.
 */
export function cueFromLiveProjection(
  projection: RoomViewMessage | undefined,
): AudioCueView | undefined {
  if (
    projection?.delivery !== 'LIVE' ||
    !projection.roomView.private.shouldPlayAudio
  ) {
    return undefined;
  }
  return projection.roomView.public.currentAudioCue ?? undefined;
}

/**
 * Records a cue only after the native player accepted replace() and play().
 * A synchronous failure therefore remains retryable through a later delivery
 * or the server's explicit ReplayAudioCue command.
 */
export function requestLiveAudioPlayback({
  cue,
  expectedVoicePackVersion,
  playedCueIds,
  player,
  reportError,
  sourceFor,
}: RequestLiveAudioPlaybackOptions): boolean {
  if (playedCueIds.has(cue.audioCueId)) return false;
  if (cue.voicePackVersion !== expectedVoicePackVersion) {
    reportError('HASH_MISMATCH');
    return false;
  }
  const source = sourceFor(cue.audioCueKey);
  if (source === undefined) {
    reportError('ASSET_MISSING');
    return false;
  }
  try {
    player.replace(source);
    player.play();
  } catch {
    reportError('LOAD_FAILED');
    return false;
  }
  playedCueIds.add(cue.audioCueId);
  return true;
}

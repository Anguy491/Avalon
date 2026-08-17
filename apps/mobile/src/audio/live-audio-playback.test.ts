import { describe, expect, it, vi } from 'vitest';

import type { RoomView, RoomViewMessage } from '@avalon/protocol/mobile';

import { acceptNewerRoomView } from '../session/room-view-state';

import {
  cueFromLiveProjection,
  requestLiveAudioPlayback,
} from './live-audio-playback';

const cue = {
  audioCueId: 'cue-team-rejected',
  audioCueKey: 'game.team.rejected',
  subtitleKey: 'game.team.rejected',
  voicePackVersion: 'zh-CN-v1',
} as const;

function view(stateVersion: number, shouldPlayAudio: boolean): RoomView {
  return {
    public: { stateVersion, currentAudioCue: cue },
    private: { shouldPlayAudio },
  } as RoomView;
}

function projection(
  delivery: 'LIVE' | 'RESYNC',
  shouldPlayAudio: boolean,
): RoomViewMessage {
  return {
    protocolVersion: 2,
    delivery,
    eventId: '00000000-0000-4000-8000-000000000001',
    roomView: view(8, shouldPlayAudio),
  } as RoomViewMessage;
}

describe('AC-012 LIVE audio playback', () => {
  it('selects only an explicitly playable LIVE transport projection', () => {
    expect(cueFromLiveProjection(projection('RESYNC', false))).toBeUndefined();
    expect(cueFromLiveProjection(projection('LIVE', false))).toBeUndefined();
    expect(cueFromLiveProjection(projection('LIVE', true))).toEqual(cue);
  });

  it('does not lose LIVE audio when an equal-version RESYNC replaces the room cache', () => {
    const resync = projection('RESYNC', false);
    const live = projection('LIVE', true);
    const cached = acceptNewerRoomView(live.roomView, resync.roomView);

    expect(cached.private.shouldPlayAudio).toBe(false);
    expect(cueFromLiveProjection(live)).toEqual(cue);
  });

  it('deduplicates only after replace and play were requested successfully', () => {
    const operations: string[] = [];
    const playedCueIds = new Set<string>();
    const reportError = vi.fn();
    const options = {
      cue,
      expectedVoicePackVersion: 'zh-CN-v1',
      playedCueIds,
      player: {
        replace: () => {
          operations.push('replace');
        },
        play: () => {
          operations.push('play');
        },
      },
      reportError,
      sourceFor: () => 42,
    };

    expect(requestLiveAudioPlayback(options)).toBe(true);
    expect(operations).toEqual(['replace', 'play']);
    expect(playedCueIds).toEqual(new Set([cue.audioCueId]));
    expect(requestLiveAudioPlayback(options)).toBe(false);
    expect(operations).toEqual(['replace', 'play']);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('keeps a synchronously failed cue unconsumed and reports the failure', () => {
    const playedCueIds = new Set<string>();
    const reportError = vi.fn();

    expect(
      requestLiveAudioPlayback({
        cue,
        expectedVoicePackVersion: 'zh-CN-v1',
        playedCueIds,
        player: {
          replace: () => {
            throw new Error('native load failed');
          },
          play: vi.fn(),
        },
        reportError,
        sourceFor: () => 42,
      }),
    ).toBe(false);
    expect(playedCueIds).toEqual(new Set());
    expect(reportError).toHaveBeenCalledWith('LOAD_FAILED');
  });
});

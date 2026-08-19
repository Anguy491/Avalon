import Taro, { useDidHide } from '@tarojs/taro';
import { useEffect, useRef } from 'react';

import { useSession } from '@/session/session-provider';

const AUDIO_SOURCES: Readonly<Record<string, string>> = {
  'game.role.reveal': '/assets/audio/zh-CN-v1/game-role-reveal.mp3',
  'game.team.proposal': '/assets/audio/zh-CN-v1/game-team-proposal.mp3',
  'game.team.vote': '/assets/audio/zh-CN-v1/game-team-vote.mp3',
  'game.team.approved': '/assets/audio/zh-CN-v1/game-team-approved.mp3',
  'game.team.rejected': '/assets/audio/zh-CN-v1/game-team-rejected.mp3',
  'game.quest.submission': '/assets/audio/zh-CN-v1/game-quest-submission.mp3',
  'game.quest.success': '/assets/audio/zh-CN-v1/game-quest-success.mp3',
  'game.quest.failure': '/assets/audio/zh-CN-v1/game-quest-failure.mp3',
  'game.assassination': '/assets/audio/zh-CN-v1/game-assassination.mp3',
  'game.good.wins': '/assets/audio/zh-CN-v1/game-good-wins.mp3',
  'game.evil.wins': '/assets/audio/zh-CN-v1/game-evil-wins.mp3',
  'game.aborted': '/assets/audio/zh-CN-v1/game-aborted.mp3',
};

export function HostAudioPlayer() {
  const { lastProjection, reportAudioTelemetry } = useSession();
  const played = useRef(new Set<string>());
  const player = useRef<Taro.InnerAudioContext>();

  useDidHide(() => {
    player.current?.stop();
    player.current?.destroy();
    player.current = undefined;
  });

  useEffect(() => {
    const projection = lastProjection;
    if (
      projection?.delivery !== 'LIVE' ||
      !projection.roomView.private.shouldPlayAudio
    ) {
      return;
    }
    const cue = projection.roomView.public.currentAudioCue;
    if (cue === null || cue === undefined || played.current.has(cue.audioCueId))
      return;
    if (cue.voicePackVersion !== 'zh-CN-v1') {
      reportAudioTelemetry('HASH_MISMATCH');
      return;
    }
    const source = AUDIO_SOURCES[cue.audioCueKey];
    if (source === undefined) {
      reportAudioTelemetry('ASSET_MISSING');
      return;
    }
    player.current?.destroy();
    const audio = Taro.createInnerAudioContext();
    player.current = audio;
    audio.src = source;
    audio.volume = 1;
    audio.onError(() => {
      reportAudioTelemetry('LOAD_FAILED');
    });
    audio.play();
    played.current.add(cue.audioCueId);
  }, [lastProjection, reportAudioTelemetry]);

  useEffect(
    () => () => {
      player.current?.stop();
      player.current?.destroy();
    },
    [],
  );
  return null;
}

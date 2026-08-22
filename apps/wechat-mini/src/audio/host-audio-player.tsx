import { Button, Slider, Text, View } from '@tarojs/components';
import Taro, { useDidHide } from '@tarojs/taro';
import { useCallback, useEffect, useRef, useState } from 'react';

import { rememberPlaybackId } from './playback-history';
import {
  VOICE_PACK_READY,
  VOICE_PACK_VERSION,
  voicePackEntryFor,
} from './voice-pack.generated';

import { useSession } from '@/session/session-provider';

const SETTINGS_KEY = 'avalon.audio.settings.v1';

interface AudioSettings {
  readonly volume: number;
  readonly muted: boolean;
}

const DEFAULT_SETTINGS: AudioSettings = { volume: 0.8, muted: false };

function validSettings(value: unknown): value is AudioSettings {
  return (
    typeof value === 'object' &&
    value !== null &&
    'volume' in value &&
    typeof value.volume === 'number' &&
    value.volume >= 0 &&
    value.volume <= 1 &&
    'muted' in value &&
    typeof value.muted === 'boolean'
  );
}

type PlaybackStatus = 'IDLE' | 'PLAYING' | 'STOPPED' | 'INTERRUPTED' | 'ERROR';

export function HostAudioPlayer() {
  const {
    lastProjection,
    roomView,
    reportAudioTelemetry,
    submitCommand,
    pendingCommandType,
  } = useSession();
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<PlaybackStatus>('IDLE');
  const [failure, setFailure] = useState<string>();
  const played = useRef<readonly string[]>([]);
  const player = useRef<Taro.InnerAudioContext>();
  const intentionalStop = useRef(false);
  const cue = roomView?.public.currentAudioCue;
  const entry =
    cue === null || cue === undefined
      ? undefined
      : voicePackEntryFor(cue.audioCueKey);
  const self = roomView?.public.players.find(
    (candidate) => candidate.playerId === roomView.private.playerId,
  );
  const isHost = self?.isHost === true;

  const persistSettings = useCallback((next: AudioSettings) => {
    setSettings(next);
    void Taro.setStorage({ key: SETTINGS_KEY, data: next });
  }, []);

  useEffect(() => {
    void Taro.getStorage<unknown>({ key: SETTINGS_KEY })
      .then((result) => {
        if (validSettings(result.data)) setSettings(result.data);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (player.current !== undefined) {
      player.current.volume = settings.muted ? 0 : settings.volume;
    }
  }, [settings]);

  const destroyCurrent = useCallback(
    (interrupted: boolean) => {
      const active = player.current;
      if (active === undefined) return;
      intentionalStop.current = !interrupted;
      active.stop();
      active.destroy();
      player.current = undefined;
      if (interrupted) {
        setStatus('INTERRUPTED');
        reportAudioTelemetry('PLAYBACK_INTERRUPTED');
      } else {
        setStatus('STOPPED');
      }
    },
    [reportAudioTelemetry],
  );

  const playCue = useCallback(
    (candidate: NonNullable<typeof cue>, remember: boolean) => {
      const candidateEntry = voicePackEntryFor(candidate.audioCueKey);
      if (
        !VOICE_PACK_READY ||
        candidate.voicePackVersion !== VOICE_PACK_VERSION
      ) {
        setFailure('语音包版本不匹配，已仅显示字幕。');
        setStatus('ERROR');
        reportAudioTelemetry('HASH_MISMATCH');
        return;
      }
      if (candidateEntry === undefined) {
        setFailure('语音文件缺失，已仅显示字幕。');
        setStatus('ERROR');
        reportAudioTelemetry('ASSET_MISSING');
        return;
      }
      if (remember && played.current.includes(candidate.audioCueId)) return;
      if (remember) {
        played.current = rememberPlaybackId(
          played.current,
          candidate.audioCueId,
        );
      }
      destroyCurrent(false);
      intentionalStop.current = false;
      setFailure(undefined);
      const audio = Taro.createInnerAudioContext();
      player.current = audio;
      audio.src = candidateEntry.source;
      audio.volume = settings.muted ? 0 : settings.volume;
      audio.onPlay(() => {
        setStatus('PLAYING');
      });
      audio.onEnded(() => {
        if (player.current === audio) player.current = undefined;
        audio.destroy();
        setStatus('IDLE');
      });
      audio.onError(() => {
        if (player.current === audio) player.current = undefined;
        audio.destroy();
        setStatus('ERROR');
        setFailure('语音加载失败，字幕不受影响。');
        reportAudioTelemetry('LOAD_FAILED');
      });
      const handleInterruption = () => {
        if (intentionalStop.current || player.current !== audio) return;
        player.current = undefined;
        audio.destroy();
        setStatus('INTERRUPTED');
        setFailure('播放已被系统中断；返回前台后不会自动重播。');
        reportAudioTelemetry('PLAYBACK_INTERRUPTED');
      };
      audio.onPause(handleInterruption);
      audio.onStop(handleInterruption);
      audio.play();
    },
    [destroyCurrent, reportAudioTelemetry, settings],
  );

  useDidHide(() => {
    if (player.current !== undefined) destroyCurrent(true);
  });

  useEffect(() => {
    const projection = lastProjection;
    if (
      projection?.delivery !== 'LIVE' ||
      !projection.roomView.private.shouldPlayAudio
    ) {
      return;
    }
    const liveCue = projection.roomView.public.currentAudioCue;
    if (liveCue !== null && liveCue !== undefined) playCue(liveCue, true);
  }, [lastProjection, playCue]);

  useEffect(
    () => () => {
      const active = player.current;
      player.current = undefined;
      if (active !== undefined) {
        intentionalStop.current = true;
        active.stop();
        active.destroy();
      }
    },
    [],
  );

  if (cue === null || cue === undefined) return null;
  return (
    <View className="audio-panel">
      <Text className="section-title">主持字幕</Text>
      <View>{entry?.subtitle ?? '语音资源不可用，请根据当前阶段继续。'}</View>
      <View className="progress">播放状态：{status}</View>
      {failure === undefined ? null : <View className="error">{failure}</View>}
      {!isHost ? null : (
        <>
          <View className="row">
            <Text>音量 {Math.round(settings.volume * 100)}%</Text>
            <View className="spacer" />
            <Button
              className="button button-secondary button-small"
              onClick={() => {
                persistSettings({ ...settings, muted: !settings.muted });
              }}
            >
              {settings.muted ? '取消静音' : '静音'}
            </Button>
          </View>
          <Slider
            min={0}
            max={100}
            step={10}
            value={Math.round(settings.volume * 100)}
            showValue
            onChange={(event) => {
              persistSettings({
                ...settings,
                volume: event.detail.value / 100,
              });
            }}
          />
          <View className="row-wrap">
            <Button
              className="button button-secondary button-small"
              onClick={() => {
                destroyCurrent(false);
              }}
            >
              停止
            </Button>
            <Button
              className="button button-secondary button-small"
              onClick={() => {
                playCue(cue, false);
              }}
            >
              播放
            </Button>
            <Button
              className="button button-secondary button-small"
              disabled={pendingCommandType !== undefined}
              onClick={() =>
                void submitCommand({
                  type: 'ReplayAudioCue',
                  payload: { audioCueId: cue.audioCueId },
                }).catch(() => undefined)
              }
            >
              显式重播
            </Button>
          </View>
        </>
      )}
    </View>
  );
}

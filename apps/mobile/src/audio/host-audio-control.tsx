import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';

import { useI18n } from '@/localization/localization-provider';
import { useSession } from '@/session/session-provider';
import { spacing, touchTarget, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

import {
  VOICE_PACK_ENTRIES,
  VOICE_PACK_VERSION,
  audioSourceFor,
  type VoicePackKey,
} from './voice-pack.generated';
import { AUDIO_SUBTITLE_KEYS } from './audio-subtitles';
import { audioPreferenceStore } from './audio-preference-store';
import {
  cueFromLiveProjection,
  requestLiveAudioPlayback,
} from './live-audio-playback';

const MUTED_KEY = 'avalon.audio.muted.v1';
const VOLUME_KEY = 'avalon.audio.volume.v1';
const DEFAULT_VOLUME = 0.8;

export function HostAudioControl() {
  const { color } = useAppTheme();
  const { t } = useI18n();
  const session = useSession();
  const cue = session.roomView?.public.currentAudioCue;
  const player = useAudioPlayer();
  const status = useAudioPlayerStatus(player);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const played = useRef(new Set<string>());
  const reportedErrors = useRef(new Set<string>());
  const attemptedCueId = useRef<string | undefined>(undefined);
  const liveCue = cueFromLiveProjection(session.lastProjection);
  const self = session.roomView?.public.players.find(
    (playerEntry) =>
      playerEntry.playerId === session.roomView?.private.playerId,
  );
  const entry = useMemo(() => {
    if (cue === null || cue === undefined) return undefined;
    return VOICE_PACK_ENTRIES[cue.subtitleKey as VoicePackKey];
  }, [cue]);

  useEffect(() => {
    void Promise.all([
      audioPreferenceStore.getItem(MUTED_KEY),
      audioPreferenceStore.getItem(VOLUME_KEY),
    ]).then(([mutedValue, volumeValue]) => {
      setMuted(mutedValue === '1');
      if (volumeValue !== null) {
        const storedVolume = Number(volumeValue);
        if (Number.isFinite(storedVolume)) {
          setVolume(Math.max(0, Math.min(1, storedVolume)));
        }
      }
    });
  }, []);

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  useEffect(() => {
    player.volume = volume;
  }, [player, volume]);

  useEffect(() => {
    if (liveCue === undefined) return;
    const requested = requestLiveAudioPlayback({
      cue: liveCue,
      expectedVoicePackVersion: VOICE_PACK_VERSION,
      playedCueIds: played.current,
      player,
      reportError: session.reportAudioTelemetry,
      sourceFor: (key) => audioSourceFor(key as VoicePackKey),
    });
    if (requested) attemptedCueId.current = liveCue.audioCueId;
  }, [liveCue, player, session.reportAudioTelemetry]);

  useEffect(() => {
    const attempted = attemptedCueId.current;
    if (status.error === null || attempted === undefined) return;
    if (reportedErrors.current.has(attempted)) return;
    reportedErrors.current.add(attempted);
    session.reportAudioTelemetry('LOAD_FAILED');
  }, [session.reportAudioTelemetry, status.error]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && player.playing) {
        player.pause();
        session.reportAudioTelemetry('PLAYBACK_INTERRUPTED');
      }
    });
    return () => {
      subscription.remove();
    };
  }, [player, session]);

  if (cue === null || cue === undefined || entry === undefined) return null;

  const hostControls = self?.isHost === true;
  return (
    <View
      style={{
        position: 'absolute',
        left: spacing.md,
        right: spacing.md,
        bottom: spacing.md,
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: 16,
        borderCurve: 'continuous',
        backgroundColor: color.surface.card,
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
      }}
    >
      <Text
        selectable
        style={{ color: color.text.primary, fontSize: typography.body }}
      >
        {t(AUDIO_SUBTITLE_KEYS[cue.subtitleKey as VoicePackKey])}
      </Text>
      {hostControls ? (
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              const next = !muted;
              setMuted(next);
              void audioPreferenceStore.setItem(MUTED_KEY, next ? '1' : '0');
            }}
            style={{ minHeight: touchTarget.minimum, justifyContent: 'center' }}
          >
            <Text selectable style={{ color: color.action.primary }}>
              {muted ? t('audioUnmute') : t('audioMute')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={volume <= 0}
            onPress={() => {
              const next = Math.max(0, Number((volume - 0.1).toFixed(1)));
              setVolume(next);
              void audioPreferenceStore.setItem(VOLUME_KEY, String(next));
            }}
            style={{ minHeight: touchTarget.minimum, justifyContent: 'center' }}
          >
            <Text selectable style={{ color: color.action.primary }}>
              {t('audioVolumeDown')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={volume >= 1}
            onPress={() => {
              const next = Math.min(1, Number((volume + 0.1).toFixed(1)));
              setVolume(next);
              void audioPreferenceStore.setItem(VOLUME_KEY, String(next));
            }}
            style={{ minHeight: touchTarget.minimum, justifyContent: 'center' }}
          >
            <Text selectable style={{ color: color.action.primary }}>
              {t('audioVolumeUp', { percent: Math.round(volume * 100) })}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={session.status !== 'CONNECTED'}
            onPress={() => {
              void session.submitCommand({
                type: 'ReplayAudioCue',
                payload: { audioCueId: cue.audioCueId },
              });
            }}
            style={{ minHeight: touchTarget.minimum, justifyContent: 'center' }}
          >
            <Text selectable style={{ color: color.action.primary }}>
              {t('audioReplay')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

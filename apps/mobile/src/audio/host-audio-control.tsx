import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';

import { useSession } from '@/session/session-provider';
import { spacing, touchTarget, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

import {
  VOICE_PACK_ENTRIES,
  VOICE_PACK_VERSION,
  audioSourceFor,
  type VoicePackKey,
} from './voice-pack.generated';
import { audioPreferenceStore } from './audio-preference-store';

const MUTED_KEY = 'avalon.audio.muted.v1';
const VOLUME_KEY = 'avalon.audio.volume.v1';
const DEFAULT_VOLUME = 0.8;

export function HostAudioControl() {
  const { color } = useAppTheme();
  const session = useSession();
  const cue = session.roomView?.public.currentAudioCue;
  const player = useAudioPlayer();
  const status = useAudioPlayerStatus(player);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const played = useRef(new Set<string>());
  const reportedErrors = useRef(new Set<string>());
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
    if (
      cue === null ||
      cue === undefined ||
      entry === undefined ||
      session.roomView?.private.shouldPlayAudio !== true ||
      played.current.has(cue.audioCueId)
    ) {
      return;
    }
    played.current.add(cue.audioCueId);
    const source = audioSourceFor(cue.audioCueKey as VoicePackKey);
    if (cue.voicePackVersion !== VOICE_PACK_VERSION || source === undefined) {
      session.reportAudioTelemetry(
        cue.voicePackVersion === VOICE_PACK_VERSION
          ? 'ASSET_MISSING'
          : 'HASH_MISMATCH',
      );
      return;
    }
    player.replace(source);
    player.play();
  }, [cue, entry, player, session]);

  useEffect(() => {
    if (status.error === null || cue === null || cue === undefined) return;
    if (reportedErrors.current.has(cue.audioCueId)) return;
    reportedErrors.current.add(cue.audioCueId);
    session.reportAudioTelemetry('LOAD_FAILED');
  }, [cue, session, status.error]);

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
        {entry.subtitle}
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
              {muted ? '取消静音' : '静音主持'}
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
              音量−
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
              音量+（{Math.round(volume * 100)}%）
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
              重播当前提示
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

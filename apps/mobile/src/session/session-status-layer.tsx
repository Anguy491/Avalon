import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, ScrollView, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { useI18n, type Translate } from '@/localization/localization-provider';
import { spacing, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

import { useSession } from './session-provider';
import {
  countdownLabel,
  derivePauseTerminationUiState,
  shouldRefreshPauseEligibility,
} from './pause-termination-state';

function remainingLabel(
  expiresAt: string | null,
  now: number,
  t: Translate,
): string {
  if (expiresAt === null) return t('pauseAwaitingRecoveryDeadline');
  const remaining = Math.max(0, Date.parse(expiresAt) - now);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return t('pauseRecoveryRemaining', {
    time: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
  });
}

export function SessionStatusLayer() {
  const { color } = useAppTheme();
  const { t } = useI18n();
  const session = useSession();
  const [now, setNow] = useState(Date.now());
  const eligibilityRefreshInFlight = useRef(false);
  const paused = session.roomView?.public.phase === 'PAUSED';
  const pauseTermination = useMemo(
    () =>
      session.roomView === undefined
        ? undefined
        : derivePauseTerminationUiState(session.roomView, now),
    [now, session.roomView],
  );

  useEffect(() => {
    if (!paused) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [paused]);

  useEffect(() => {
    if (
      session.roomView?.public.phase !== 'GAME_OVER' ||
      session.roomView.public.gameOutcome?.reason !== 'ABORTED'
    ) {
      return;
    }
    router.replace('/');
  }, [session.roomView]);

  useEffect(() => {
    if (
      session.roomView === undefined ||
      pauseTermination === undefined ||
      !shouldRefreshPauseEligibility(
        session.roomView,
        pauseTermination,
        session.status === 'CONNECTED',
      ) ||
      eligibilityRefreshInFlight.current
    ) {
      return;
    }
    eligibilityRefreshInFlight.current = true;
    void session.refreshView().finally(() => {
      eligibilityRefreshInFlight.current = false;
    });
  }, [pauseTermination, paused, session]);

  const offlinePlayers = useMemo(
    () =>
      session.roomView?.public.players.filter((player) => !player.connected) ??
      [],
    [session.roomView],
  );
  const canResume =
    session.status === 'CONNECTED' &&
    session.roomView?.private.availableActions.some(
      (action) => action.commandType === 'ResumeGame',
    ) === true;
  const ballot = session.roomView?.public.pauseTerminationVote;

  const startTerminationVote = () => {
    Alert.alert(t('pauseStartVoteTitle'), t('pauseStartVoteBody'), [
      { text: t('commonCancel'), style: 'cancel' },
      {
        text: t('pauseStartVoteConfirm'),
        style: 'destructive',
        onPress: () => {
          void session
            .submitCommand({
              type: 'StartPauseTerminationVote',
              payload: {},
            })
            .catch(() => undefined);
        },
      },
    ]);
  };

  const submitTerminationChoice = (choice: 'TERMINATE' | 'CONTINUE_PAUSE') => {
    const terminating = choice === 'TERMINATE';
    Alert.alert(
      terminating
        ? t('pauseTerminateConfirmTitle')
        : t('pauseContinueConfirmTitle'),
      t('pauseChoiceConfirmBody'),
      [
        { text: t('commonBack'), style: 'cancel' },
        {
          text: terminating ? t('pauseVoteTerminate') : t('pauseVoteContinue'),
          style: terminating ? 'destructive' : 'default',
          onPress: () => {
            void session
              .submitCommand({
                type: 'SubmitPauseTerminationVote',
                payload: { choice },
              })
              .catch(() => undefined);
          },
        },
      ],
    );
  };

  return (
    <>
      {!paused &&
      session.roomView !== undefined &&
      (session.status === 'OFFLINE' || session.status === 'RECOVERING') ? (
        <View
          accessibilityLiveRegion="polite"
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: spacing.lg,
            left: spacing.md,
            right: spacing.md,
            zIndex: 10,
            padding: spacing.md,
            borderRadius: 14,
            backgroundColor: color.surface.blocking,
          }}
        >
          <Text
            selectable
            style={{ color: color.text.inverse, fontWeight: '700' }}
          >
            {session.networkReachable
              ? t('statusResyncing')
              : t('statusOffline')}
          </Text>
        </View>
      ) : null}

      <Modal
        animationType="fade"
        onRequestClose={() => undefined}
        transparent
        visible={paused}
      >
        <ScrollView
          accessibilityViewIsModal
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            padding: spacing.lg,
          }}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.72)',
          }}
        >
          <View
            style={{
              gap: spacing.md,
              padding: spacing.lg,
              borderRadius: 22,
              backgroundColor: color.surface.blocking,
            }}
          >
            <Text
              accessibilityRole="header"
              selectable
              style={{
                color: color.text.inverse,
                fontSize: typography.title,
                fontWeight: '900',
              }}
            >
              {t('pausePaused')}
            </Text>
            {session.roomView?.public.manualPauseReason !== null ? (
              <Text selectable style={{ color: color.text.inverse }}>
                {t('pauseManualReason', {
                  reason: session.roomView?.public.manualPauseReason ?? '',
                })}
              </Text>
            ) : null}
            {offlinePlayers.length > 0 ? (
              <Text selectable style={{ color: color.text.inverse }}>
                {t('pauseOfflinePlayers', {
                  players: offlinePlayers
                    .map((player) => player.nickname)
                    .join(t('commonListSeparator')),
                })}
              </Text>
            ) : null}
            <Text selectable style={{ color: color.text.inverse }}>
              {remainingLabel(
                session.roomView?.public.recoveryExpiresAt ?? null,
                now,
                t,
              )}
            </Text>
            <Text selectable style={{ color: color.text.inverse }}>
              {t('pauseAuthorityNote')}
            </Text>
            {ballot == null &&
            pauseTermination !== undefined &&
            pauseTermination.availableInMs > 0 ? (
              <Text
                accessibilityLiveRegion="polite"
                selectable
                style={{
                  color: color.text.inverse,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {t('pauseVoteAvailableIn', {
                  time: countdownLabel(pauseTermination.availableInMs),
                })}
              </Text>
            ) : null}
            {ballot == null && pauseTermination?.canStart === true ? (
              <PrimaryButton
                accessibilityHint={t('pauseStartVoteHint')}
                busy={
                  session.pendingCommandType === 'StartPauseTerminationVote'
                }
                label={t('pauseStartVote')}
                onPress={startTerminationVote}
              />
            ) : null}
            {ballot != null && pauseTermination !== undefined ? (
              <View
                accessible
                accessibilityLabel={t('pauseVoteProgressAccessibility', {
                  submitted: pauseTermination.submittedCount,
                  eligible: pauseTermination.eligibleCount,
                  time: countdownLabel(pauseTermination.ballotRemainingMs),
                })}
                style={{ gap: spacing.sm }}
              >
                <Text
                  accessibilityRole="header"
                  selectable
                  style={{
                    color: color.text.inverse,
                    fontSize: typography.body,
                    fontWeight: '800',
                  }}
                >
                  {t('pauseVoteTitle')}
                </Text>
                <Text
                  accessibilityLiveRegion="polite"
                  selectable
                  style={{
                    color: color.text.inverse,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {t('pauseVoteProgress', {
                    submitted: pauseTermination.submittedCount,
                    eligible: pauseTermination.eligibleCount,
                    time: countdownLabel(pauseTermination.ballotRemainingMs),
                  })}
                </Text>
                <Text selectable style={{ color: color.text.inverse }}>
                  {t('pauseVoteRule')}
                </Text>
              </View>
            ) : null}
            {ballot != null && pauseTermination?.canSubmit === true ? (
              <>
                <PrimaryButton
                  busy={
                    session.pendingCommandType === 'SubmitPauseTerminationVote'
                  }
                  label={t('pauseVoteTerminateGame')}
                  onPress={() => {
                    submitTerminationChoice('TERMINATE');
                  }}
                />
                <PrimaryButton
                  busy={
                    session.pendingCommandType === 'SubmitPauseTerminationVote'
                  }
                  label={t('pauseVoteContinuePause')}
                  onPress={() => {
                    submitTerminationChoice('CONTINUE_PAUSE');
                  }}
                />
              </>
            ) : null}
            {ballot != null && pauseTermination?.voterStatus === 'SUBMITTED' ? (
              <Text
                accessibilityLiveRegion="polite"
                selectable
                style={{ color: color.text.inverse, fontWeight: '800' }}
              >
                {t('pauseVoteSubmitted')}
              </Text>
            ) : null}
            {ballot != null &&
            pauseTermination?.voterStatus === 'NOT_ELIGIBLE' ? (
              <Text selectable style={{ color: color.text.inverse }}>
                {t('pauseVoteNotEligible')}
              </Text>
            ) : null}
            {canResume ? (
              <PrimaryButton
                accessibilityHint={t('pauseResumeHint')}
                busy={session.pendingCommandType === 'ResumeGame'}
                label={t('pauseResume')}
                onPress={() => {
                  void session
                    .submitCommand({
                      type: 'ResumeGame',
                      payload: {},
                    })
                    .catch(() => undefined);
                }}
              />
            ) : null}
          </View>
        </ScrollView>
      </Modal>
    </>
  );
}

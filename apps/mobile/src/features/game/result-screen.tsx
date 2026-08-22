import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect, useMemo } from 'react';
import { Text, View, type ColorValue } from 'react-native';

import { PageShell } from '@/components/page-shell';
import { PrimaryButton } from '@/components/primary-button';
import {
  ALIGNMENT_KEYS,
  mappedMessageKey,
  OUTCOME_REASON_KEYS,
  ROLE_NAME_KEYS,
  WINNER_KEYS,
} from '@/localization/game-messages';
import { useI18n } from '@/localization/localization-provider';
import { useSession } from '@/session/session-provider';
import { spacing, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

import { deriveResultState } from './result-state';

function ResultCard({
  children,
  backgroundColor,
}: {
  readonly children: React.ReactNode;
  readonly backgroundColor: ColorValue;
}) {
  return (
    <View
      style={{
        gap: spacing.md,
        padding: spacing.lg,
        borderRadius: 18,
        borderCurve: 'continuous',
        backgroundColor,
      }}
    >
      {children}
    </View>
  );
}

export function ResultScreen() {
  const { color } = useAppTheme();
  const { t } = useI18n();
  const session = useSession();
  const roomView = session.roomView;
  const result = useMemo(
    () => (roomView === undefined ? undefined : deriveResultState(roomView)),
    [roomView],
  );

  useEffect(() => {
    const phase = roomView?.public.phase;
    if (phase === undefined || phase === 'GAME_OVER') return;
    if (phase === 'LOBBY') router.replace('/lobby');
    else if (phase === 'ROLE_REVEAL') router.replace('/role');
    else if (phase === 'ASSASSINATION') router.replace('/assassination');
    else router.replace('/game');
  }, [roomView?.public.phase]);

  if (roomView === undefined || result === undefined) {
    return (
      <PageShell>
        <Stack.Screen options={{ title: t('navResult') }} />
        <Text
          accessibilityRole="header"
          selectable
          style={{ color: color.text.primary, fontSize: typography.title }}
        >
          {t('resultLoading')}
        </Text>
      </PageShell>
    );
  }

  const outcomeColor: ColorValue =
    result.winner === 'GOOD'
      ? color.result.success
      : result.winner === 'EVIL'
        ? color.result.failure
        : color.surface.blocking;
  const playerName = (playerId: string) =>
    result.players.find((player) => player.playerId === playerId)?.nickname ??
    t('commonUnknownPlayer');

  return (
    <PageShell>
      <Stack.Screen
        options={{
          title: t('navResult'),
          headerBackVisible: false,
          gestureEnabled: false,
        }}
      />

      <ResultCard backgroundColor={outcomeColor}>
        <Text
          accessibilityLiveRegion="assertive"
          accessibilityRole="header"
          selectable
          style={{ color: '#FFFFFF', fontSize: 34, fontWeight: '900' }}
        >
          {t(mappedMessageKey(WINNER_KEYS, result.winner, 'outcomeAborted'))}
        </Text>
        <Text
          selectable
          style={{ color: '#FFFFFF', fontSize: typography.body }}
        >
          {t(
            mappedMessageKey(
              OUTCOME_REASON_KEYS,
              result.reason,
              'outcomeEnded',
            ),
          )}
        </Text>
        {result.assassinationTarget === undefined ? null : (
          <Text
            selectable
            style={{ color: '#FFFFFF', fontSize: typography.body }}
          >
            {t('resultAssassinationTarget', {
              seat: result.assassinationTarget.seat + 1,
              nickname: result.assassinationTarget.nickname,
            })}
          </Text>
        )}
      </ResultCard>

      <ResultCard backgroundColor={color.surface.card}>
        <Text
          accessibilityRole="header"
          selectable
          style={{
            color: color.text.primary,
            fontSize: 20,
            fontWeight: '900',
          }}
        >
          {t('resultFinalScore')}
        </Text>
        <Text
          selectable
          style={{
            color: color.text.primary,
            fontSize: 24,
            fontWeight: '900',
            fontVariant: ['tabular-nums'],
          }}
        >
          {t('resultScoreSummary', {
            successes: result.successCount,
            failures: result.failureCount,
          })}
        </Text>
      </ResultCard>

      <ResultCard backgroundColor={color.surface.card}>
        <Text
          accessibilityRole="header"
          selectable
          style={{
            color: color.text.primary,
            fontSize: 20,
            fontWeight: '900',
          }}
        >
          {t('resultAllRoles')}
        </Text>
        {result.revealedPlayers.map((player) => (
          <View
            accessible
            accessibilityLabel={t('resultPlayerAccessibility', {
              seat: player.seat + 1,
              nickname: player.nickname,
              role: t(
                mappedMessageKey(
                  ROLE_NAME_KEYS,
                  player.roleId,
                  'commonUnknownRole',
                ),
              ),
              alignment: t(
                mappedMessageKey(
                  ALIGNMENT_KEYS,
                  player.alignment,
                  'commonUnknownAlignment',
                ),
              ),
              targetSuffix: player.wasAssassinationTarget
                ? t('resultTargetSuffix')
                : '',
            })}
            key={player.playerId}
            style={{
              gap: spacing.xs,
              padding: spacing.md,
              borderRadius: 14,
              borderCurve: 'continuous',
              backgroundColor: color.surface.public,
            }}
          >
            <Text
              selectable
              style={{
                color: color.text.primary,
                fontSize: typography.body,
                fontWeight: '900',
              }}
            >
              {t('resultPlayerTitle', {
                seat: player.seat + 1,
                nickname: player.nickname,
                targetSuffix: player.wasAssassinationTarget
                  ? ` · ${t('assassinationTarget')}`
                  : '',
              })}
            </Text>
            <Text
              selectable
              style={{
                color:
                  player.alignment === 'GOOD'
                    ? color.result.success
                    : color.result.failure,
                fontSize: typography.body,
                fontWeight: '800',
              }}
            >
              {t('resultRoleAlignment', {
                role: t(
                  mappedMessageKey(
                    ROLE_NAME_KEYS,
                    player.roleId,
                    'commonUnknownRole',
                  ),
                ),
                alignment: t(
                  mappedMessageKey(
                    ALIGNMENT_KEYS,
                    player.alignment,
                    'commonUnknownAlignment',
                  ),
                ),
              })}
            </Text>
          </View>
        ))}
      </ResultCard>

      <ResultCard backgroundColor={color.surface.card}>
        <Text
          accessibilityRole="header"
          selectable
          style={{
            color: color.text.primary,
            fontSize: 20,
            fontWeight: '900',
          }}
        >
          {t('resultPublicHistory')}
        </Text>
        {result.proposalHistory.map((proposal) => (
          <View
            key={`proposal-${String(proposal.questIndex)}-${String(proposal.proposalAttempt)}`}
            style={{ gap: spacing.xs }}
          >
            <Text
              selectable
              style={{
                color: color.text.primary,
                fontSize: typography.body,
                fontWeight: '900',
              }}
            >
              {t('historyProposalTitle', {
                quest: proposal.questIndex,
                attempt: proposal.proposalAttempt,
                result: proposal.approved
                  ? t('commonApproved')
                  : t('commonReject'),
              })}
            </Text>
            <Text
              selectable
              style={{
                color: color.text.secondary,
                fontSize: typography.supporting,
              }}
            >
              {t('historyLeaderVotes', {
                leader: playerName(proposal.leaderPlayerId),
                approves: proposal.approveCount,
                rejects: proposal.rejectCount,
              })}
            </Text>
            <Text
              selectable
              style={{
                color: color.text.secondary,
                fontSize: typography.supporting,
              }}
            >
              {t('historyTeam', {
                players: proposal.teamPlayerIds
                  .map(playerName)
                  .join(t('commonListSeparator')),
              })}
            </Text>
            {proposal.votes.map((vote) => (
              <Text
                key={`${String(proposal.questIndex)}-${String(proposal.proposalAttempt)}-${vote.playerId}`}
                selectable
                style={{
                  color: color.text.secondary,
                  fontSize: typography.supporting,
                }}
              >
                {t('historyVote', {
                  player: playerName(vote.playerId),
                  vote:
                    vote.vote === 'APPROVE'
                      ? t('commonApprove')
                      : t('commonReject'),
                })}
              </Text>
            ))}
          </View>
        ))}
        {result.questHistory.map((quest) => (
          <View
            key={`quest-${String(quest.questIndex)}`}
            style={{ gap: spacing.xs }}
          >
            <Text
              selectable
              style={{
                color: color.text.primary,
                fontSize: typography.body,
                fontWeight: '900',
              }}
            >
              {t('historyQuestTitle', {
                quest: quest.questIndex,
                result:
                  quest.result === 'SUCCESS'
                    ? t('commonSuccess')
                    : t('commonFailure'),
              })}
            </Text>
            <Text
              selectable
              style={{
                color: color.text.secondary,
                fontSize: typography.supporting,
              }}
            >
              {t('historyTeam', {
                players: quest.teamPlayerIds
                  .map(playerName)
                  .join(t('commonListSeparator')),
              })}
            </Text>
            <Text
              selectable
              style={{
                color: color.text.secondary,
                fontSize: typography.supporting,
              }}
            >
              {t('historyAnonymousActions', {
                successes: quest.successChoices,
                failures: quest.failChoices,
                requiredFails: quest.requiredFails,
              })}
            </Text>
          </View>
        ))}
      </ResultCard>

      <Text
        selectable
        style={{ color: color.text.secondary, fontSize: typography.supporting }}
      >
        {t('resultPrivacy')}
      </Text>
      <PrimaryButton
        label={t('resultReturnHome')}
        onPress={() => {
          void session.forgetSession().then(() => {
            router.replace('/');
          });
        }}
      />
    </PageShell>
  );
}

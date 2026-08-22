import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, Text, View, type ColorValue } from 'react-native';

import { PageShell } from '@/components/page-shell';
import { PrimaryButton } from '@/components/primary-button';
import {
  CONTINUE_ACTION_KEYS,
  mappedMessageKey,
  OUTCOME_REASON_KEYS,
  PHASE_KEYS,
} from '@/localization/game-messages';
import { useI18n } from '@/localization/localization-provider';
import type { MessageKey } from '@/localization/messages';
import { useSession } from '@/session/session-provider';
import { spacing, touchTarget, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';
import { RoleGuideControl } from '@/features/roles/role-guide-control';

import { ConfirmationModal } from './confirmation-modal';
import { deriveGameTableState } from './game-state';
import { useGameCommands } from './use-game-commands';

type Confirmation =
  | { readonly type: 'TEAM' }
  | { readonly type: 'VOTE'; readonly vote: 'APPROVE' | 'REJECT' }
  | { readonly type: 'QUEST'; readonly choice: 'SUCCESS' | 'FAIL' };

type LocallySubmittedAction = 'VOTE' | 'QUEST';

const QUEST_STATE_KEYS = {
  SUCCESS: 'gameQuestStateSuccess',
  FAILURE: 'gameQuestStateFailure',
  CURRENT: 'gameQuestStateCurrent',
  PENDING: 'gameQuestStatePending',
} as const satisfies Readonly<Record<string, MessageKey>>;

function Card({
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
        padding: spacing.md,
        borderRadius: 18,
        borderCurve: 'continuous',
        backgroundColor,
      }}
    >
      {children}
    </View>
  );
}

function Heading({ children }: { readonly children: React.ReactNode }) {
  const { color } = useAppTheme();
  return (
    <Text
      accessibilityRole="header"
      selectable
      style={{
        color: color.text.primary,
        fontSize: 20,
        fontWeight: '900',
      }}
    >
      {children}
    </Text>
  );
}

export function GameScreen() {
  const { color } = useAppTheme();
  const { t } = useI18n();
  const session = useSession();
  const commands = useGameCommands();
  const roomView = session.roomView;
  const table = useMemo(
    () => (roomView === undefined ? undefined : deriveGameTableState(roomView)),
    [roomView],
  );
  const [selectedTeam, setSelectedTeam] = useState<readonly string[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [questChoicesVisible, setQuestChoicesVisible] = useState(false);
  const [locallySubmittedAction, setLocallySubmittedAction] =
    useState<LocallySubmittedAction>();
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const phaseIdentity = `${table?.phase ?? 'NONE'}:${table?.phaseStage ?? 'NONE'}:${String(
    table?.questIndex ?? 0,
  )}:${String(table?.proposalAttempt ?? 0)}:${String(roomView?.public.stateVersion ?? 0)}`;

  useEffect(() => {
    setSelectedTeam([]);
    setConfirmation(undefined);
    setQuestChoicesVisible(false);
    setLocallySubmittedAction(undefined);
  }, [phaseIdentity, session.resyncEpoch]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        setSelectedTeam([]);
        setConfirmation(undefined);
        setQuestChoicesVisible(false);
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const phase = roomView?.public.phase;
    if (phase === 'LOBBY') router.replace('/lobby');
    else if (phase === 'ROLE_REVEAL') router.replace('/role');
    else if (phase === 'ASSASSINATION') router.replace('/assassination');
    else if (phase === 'GAME_OVER')
      router.replace(
        roomView?.public.gameOutcome?.reason === 'ABORTED' ? '/' : '/result',
      );
    else if (phase === undefined && session.status === 'ANONYMOUS')
      router.replace('/');
  }, [
    roomView?.public.gameOutcome?.reason,
    roomView?.public.phase,
    session.status,
  ]);

  if (roomView === undefined || table === undefined) {
    return (
      <PageShell>
        <Stack.Screen options={{ title: t('navGame') }} />
        <Text
          accessibilityRole="header"
          selectable
          style={{ color: color.text.primary, fontSize: typography.title }}
        >
          {t('gameSyncing')}
        </Text>
        <PrimaryButton
          label={t('commonResync')}
          onPress={() => void session.refreshView()}
        />
      </PageShell>
    );
  }

  const busy = commands.pendingCommandType !== undefined;
  const interactive = session.status === 'CONNECTED' && !busy;
  const latestProposal = table.latestProposal;
  const latestQuest = table.latestQuest;
  const requiredTeamSize = table.requiredTeamSize ?? 0;
  const selectedPlayers = table.players.filter((player) =>
    selectedTeam.includes(player.playerId),
  );
  const phaseLabel = t(mappedMessageKey(PHASE_KEYS, table.phase, 'navGame'));
  const seatPlayerLabel = (seat: number, nickname: string) =>
    t('gameSeatPlayer', { seat: seat + 1, nickname });

  const submitConfirmation = async () => {
    const pending = confirmation;
    if (pending === undefined) return;
    if (pending.type === 'TEAM') {
      const submitted = await commands.submitTeam(selectedTeam);
      if (submitted) setSelectedTeam([]);
    } else if (pending.type === 'VOTE') {
      const submitted = await commands.submitTeamVote(pending.vote);
      if (submitted) setLocallySubmittedAction('VOTE');
    } else {
      const submitted = await commands.submitQuestChoice(pending.choice);
      if (submitted) {
        setQuestChoicesVisible(false);
        setLocallySubmittedAction('QUEST');
      }
    }
    setConfirmation(undefined);
  };

  const confirmationContent = (() => {
    if (confirmation?.type === 'TEAM') {
      return {
        title: t('gameConfirmTeamTitle'),
        description: selectedPlayers
          .map((player) => seatPlayerLabel(player.seat, player.nickname))
          .join(t('commonListSeparator')),
        confirmLabel: t('gameConfirmTeam'),
      };
    }
    if (confirmation?.type === 'VOTE') {
      const label =
        confirmation.vote === 'APPROVE'
          ? t('commonApprove')
          : t('commonReject');
      return {
        title: t('gameConfirmVoteTitle', { choice: label }),
        description: t('gameConfirmVoteBody', { choice: label }),
        confirmLabel: t('gameConfirmChoice', { choice: label }),
      };
    }
    const label =
      confirmation?.choice === 'FAIL'
        ? t('gameQuestFailed')
        : t('gameQuestSucceeded');
    return {
      title: t('gameConfirmQuestTitle', { choice: label }),
      description: t('gameConfirmQuestBody', { choice: label }),
      confirmLabel: t('gameConfirmChoice', { choice: label }),
    };
  })();

  return (
    <PageShell>
      <Stack.Screen
        options={{
          title: t('gameHeaderTitle', {
            quest: table.questIndex ?? '—',
            phase: phaseLabel,
          }),
          headerBackVisible: false,
          gestureEnabled: false,
        }}
      />

      <View style={{ gap: spacing.xs }}>
        <Text
          accessibilityRole="header"
          selectable
          style={{
            color: color.text.primary,
            fontSize: typography.title,
            fontWeight: '900',
          }}
        >
          {phaseLabel}
        </Text>
        <Text
          selectable
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          {t('gameCurrentLeader', {
            leader: table.leader?.nickname ?? t('gameAwaitingLeader'),
            attempt: table.proposalAttempt,
          })}
        </Text>
        <Text
          accessibilityLiveRegion="polite"
          selectable
          style={{
            color: color.text.secondary,
            fontSize: typography.supporting,
          }}
        >
          {t('lobbyConnectionStatus', {
            status:
              session.status === 'CONNECTED'
                ? t('commonOnline')
                : t('commonRecovering'),
            copiedSuffix: '',
          })}
        </Text>
      </View>

      <RoleGuideControl
        roleId={roomView.private.selfRole}
        available={roomView.public.phase !== 'PAUSED'}
        resetKey={`${String(session.resyncEpoch)}:${roomView.public.phase}`}
      />

      <Card backgroundColor={color.surface.card}>
        <Heading>{t('gameQuestTrack')}</Heading>
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
        >
          {table.questTrack.map((quest) => {
            const label = t(QUEST_STATE_KEYS[quest.state]);
            const background =
              quest.state === 'SUCCESS'
                ? color.result.success
                : quest.state === 'FAILURE'
                  ? color.result.failure
                  : quest.state === 'CURRENT'
                    ? color.result.pending
                    : color.action.disabled;
            return (
              <View
                accessible
                accessibilityLabel={t('gameQuestAccessibility', {
                  quest: quest.questIndex,
                  state: label,
                  twoFailsSuffix:
                    quest.requiredFails === 2
                      ? t('gameTwoFailsAccessibilitySuffix')
                      : '',
                })}
                key={quest.questIndex}
                style={{
                  minWidth: 86,
                  flexGrow: 1,
                  gap: spacing.xs,
                  padding: spacing.sm,
                  borderRadius: 14,
                  borderCurve: 'continuous',
                  backgroundColor: background,
                }}
              >
                <Text
                  selectable
                  style={{ color: color.text.inverse, fontWeight: '900' }}
                >
                  {t('gameQuestLabel', { quest: quest.questIndex })}
                </Text>
                <Text selectable style={{ color: color.text.inverse }}>
                  {label}
                </Text>
              </View>
            );
          })}
        </View>
        <Text
          selectable
          style={{
            color: color.text.primary,
            fontSize: typography.body,
            fontVariant: ['tabular-nums'],
            fontWeight: '800',
          }}
        >
          {t('gameScore', {
            successes: table.successCount,
            failures: table.failureCount,
          })}
        </Text>
        <Text
          selectable
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          {t('gameTeamRequirement', {
            teamSize: table.requiredTeamSize ?? '—',
            twoFailsSuffix:
              table.requiredQuestFails === 2 ? t('gameTwoFailsSuffix') : '',
          })}
        </Text>
      </Card>

      {table.proposedTeam.length === 0 ? null : (
        <Card backgroundColor={color.surface.card}>
          <Heading>{t('gameProposedTeam')}</Heading>
          <Text
            selectable
            style={{ color: color.text.primary, fontSize: typography.body }}
          >
            {table.proposedTeam
              .map((player) => seatPlayerLabel(player.seat, player.nickname))
              .join(t('commonListSeparator'))}
          </Text>
        </Card>
      )}

      {table.submissionProgress === undefined ? null : (
        <Card backgroundColor={color.surface.card}>
          <Heading>{t('gameSubmissionProgress')}</Heading>
          <Text
            accessibilityLiveRegion="polite"
            selectable
            style={{
              color: color.text.primary,
              fontSize: 24,
              fontWeight: '900',
              fontVariant: ['tabular-nums'],
            }}
          >
            {table.submissionProgress.submittedCount} /{' '}
            {table.submissionProgress.requiredCount}
          </Text>
          <Text
            selectable
            style={{
              color: color.text.secondary,
              fontSize: typography.supporting,
            }}
          >
            {t('gameSubmissionPrivacy')}
          </Text>
        </Card>
      )}

      {table.phaseStage === 'HOST_HELD' ? (
        <Card backgroundColor={color.surface.blocking}>
          <Text
            accessibilityRole="header"
            selectable
            style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '900' }}
          >
            {t('gameDiscussFirst')}
          </Text>
          <Text
            selectable
            style={{ color: '#D5D9E2', fontSize: typography.body }}
          >
            {t('gameDiscussFirstBody')}
          </Text>
          {table.canContinue && table.continueAction !== undefined ? (
            <PrimaryButton
              label={t(CONTINUE_ACTION_KEYS[table.continueAction])}
              busy={commands.pendingCommandType === 'ContinuePhase'}
              disabled={!interactive}
              onPress={() => void commands.continuePhase()}
            />
          ) : null}
        </Card>
      ) : null}

      {table.phase === 'TEAM_PROPOSAL' && table.phaseStage === 'COLLECTING' ? (
        table.canSubmitTeam ? (
          <Card backgroundColor={color.surface.card}>
            <Heading>
              {t('gameChooseTeam', { count: requiredTeamSize })}
            </Heading>
            {table.players.map((player) => {
              const selected = selectedTeam.includes(player.playerId);
              return (
                <Pressable
                  accessibilityLabel={t('gamePlayerAccessibility', {
                    seat: player.seat + 1,
                    nickname: player.nickname,
                    selfSuffix:
                      player.playerId === table.selfPlayerId
                        ? t('gameSelfSuffix')
                        : '',
                  })}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  key={player.playerId}
                  onPress={() => {
                    setSelectedTeam((current) =>
                      current.includes(player.playerId)
                        ? current.filter((id) => id !== player.playerId)
                        : current.length < requiredTeamSize
                          ? [...current, player.playerId]
                          : current,
                    );
                  }}
                  style={({ pressed }) => ({
                    minHeight: touchTarget.minimum,
                    justifyContent: 'center',
                    padding: spacing.md,
                    borderRadius: 14,
                    borderCurve: 'continuous',
                    borderWidth: 2,
                    borderColor: selected
                      ? color.action.selected
                      : color.action.disabled,
                    backgroundColor: selected
                      ? color.result.pending
                      : color.surface.public,
                    opacity: pressed ? 0.72 : 1,
                  })}
                >
                  <Text
                    selectable
                    style={{
                      color: color.text.primary,
                      fontSize: typography.body,
                      fontWeight: '800',
                    }}
                  >
                    {t('gamePlayerOption', {
                      seat: player.seat + 1,
                      nickname: player.nickname,
                      selfSuffix:
                        player.playerId === table.selfPlayerId
                          ? t('gameSelfBadge')
                          : '',
                    })}
                  </Text>
                </Pressable>
              );
            })}
            <PrimaryButton
              label={t('gameSubmitTeam', {
                selected: selectedTeam.length,
                required: requiredTeamSize,
              })}
              disabled={
                !interactive || selectedTeam.length !== requiredTeamSize
              }
              onPress={() => {
                setConfirmation({ type: 'TEAM' });
              }}
            />
          </Card>
        ) : (
          <Card backgroundColor={color.surface.card}>
            <Heading>{t('gameWaitingLeader')}</Heading>
            <Text
              selectable
              style={{ color: color.text.secondary, fontSize: typography.body }}
            >
              {t('gameWaitingLeaderBody')}
            </Text>
          </Card>
        )
      ) : null}

      {table.phase === 'TEAM_VOTE' && table.phaseStage === 'COLLECTING' ? (
        table.hasSubmitted || locallySubmittedAction === 'VOTE' ? (
          <Card backgroundColor={color.surface.private}>
            <Text
              accessibilityRole="header"
              selectable
              style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '900' }}
            >
              {t('gameVoteSubmitted')}
            </Text>
            <Text
              selectable
              style={{ color: '#D5D9E2', fontSize: typography.body }}
            >
              {t('gameVoteSubmittedBody')}
            </Text>
          </Card>
        ) : table.allowedTeamVotes.length > 0 ? (
          <Card backgroundColor={color.surface.private}>
            <Text
              accessibilityRole="header"
              selectable
              style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '900' }}
            >
              {t('gamePrivateVote')}
            </Text>
            <Text
              selectable
              style={{ color: '#D5D9E2', fontSize: typography.body }}
            >
              {t('gamePrivateVoteBody')}
            </Text>
            {table.allowedTeamVotes.includes('APPROVE') ? (
              <PrimaryButton
                label={t('gameApproveTeam')}
                disabled={!interactive}
                onPress={() => {
                  setConfirmation({ type: 'VOTE', vote: 'APPROVE' });
                }}
              />
            ) : null}
            {table.allowedTeamVotes.includes('REJECT') ? (
              <Pressable
                accessibilityRole="button"
                disabled={!interactive}
                onPress={() => {
                  setConfirmation({ type: 'VOTE', vote: 'REJECT' });
                }}
                style={({ pressed }) => ({
                  minHeight: touchTarget.minimum,
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: spacing.md,
                  borderRadius: 16,
                  borderCurve: 'continuous',
                  borderWidth: 2,
                  borderColor: color.action.destructive,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text
                  selectable
                  style={{
                    color: '#FFFFFF',
                    fontSize: typography.body,
                    fontWeight: '900',
                  }}
                >
                  {t('gameRejectTeam')}
                </Text>
              </Pressable>
            ) : null}
          </Card>
        ) : null
      ) : null}

      {table.phase === 'TEAM_VOTE' &&
      table.phaseStage === 'RESOLVED' &&
      latestProposal !== undefined ? (
        <Card backgroundColor={color.surface.card}>
          <Heading>
            {latestProposal.approved
              ? t('gameTeamApproved')
              : t('gameTeamRejected')}
          </Heading>
          <Text
            selectable
            style={{
              color: color.text.primary,
              fontSize: typography.body,
              fontWeight: '900',
            }}
          >
            {t('gameVoteSummary', {
              approves: latestProposal.approveCount,
              rejects: latestProposal.rejectCount,
            })}
          </Text>
          {latestProposal.votes.map((vote) => {
            const player = table.players.find(
              (candidate) => candidate.playerId === vote.playerId,
            );
            return (
              <Text
                key={vote.playerId}
                selectable
                style={{ color: color.text.primary, fontSize: typography.body }}
              >
                {t('historyVote', {
                  player:
                    player === undefined
                      ? t('commonUnknownPlayer')
                      : seatPlayerLabel(player.seat, player.nickname),
                  vote:
                    vote.vote === 'APPROVE'
                      ? t('commonApprove')
                      : t('commonReject'),
                })}
              </Text>
            );
          })}
          {!latestProposal.approved &&
          latestProposal.approveCount === latestProposal.rejectCount ? (
            <Text
              selectable
              style={{
                color: color.result.failure,
                fontSize: typography.body,
                fontWeight: '800',
              }}
            >
              {t('gameTieRejected')}
            </Text>
          ) : null}
          {!latestProposal.approved && table.outcomeReason === undefined ? (
            <Text
              selectable
              style={{ color: color.text.secondary, fontSize: typography.body }}
            >
              {t('gameNextLeader', {
                leader: table.leader?.nickname ?? t('gameAwaitingLeader'),
              })}
            </Text>
          ) : null}
          {table.outcomeReason === undefined ? null : (
            <Text
              accessibilityLiveRegion="assertive"
              selectable
              style={{
                color: color.result.failure,
                fontSize: typography.body,
                fontWeight: '900',
              }}
            >
              {t(
                mappedMessageKey(
                  OUTCOME_REASON_KEYS,
                  table.outcomeReason,
                  'outcomeEnded',
                ),
              )}
            </Text>
          )}
          {table.canContinue && table.continueAction !== undefined ? (
            <PrimaryButton
              label={t(CONTINUE_ACTION_KEYS[table.continueAction])}
              busy={commands.pendingCommandType === 'ContinuePhase'}
              disabled={!interactive}
              onPress={() => void commands.continuePhase()}
            />
          ) : null}
        </Card>
      ) : null}

      {table.phase === 'QUEST_SUBMISSION' &&
      table.phaseStage === 'COLLECTING' ? (
        table.hasSubmitted || locallySubmittedAction === 'QUEST' ? (
          <Card backgroundColor={color.surface.private}>
            <Text
              accessibilityRole="header"
              selectable
              style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '900' }}
            >
              {t('gameQuestSubmitted')}
            </Text>
            <Text
              selectable
              style={{ color: '#D5D9E2', fontSize: typography.body }}
            >
              {t('gameQuestSubmittedBody')}
            </Text>
          </Card>
        ) : table.allowedQuestChoices.length > 0 ? (
          <Card backgroundColor={color.surface.private}>
            <Text
              accessibilityRole="header"
              selectable
              style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '900' }}
            >
              {t('gamePrivateQuest')}
            </Text>
            {!questChoicesVisible ? (
              <>
                <Text
                  selectable
                  style={{ color: '#D5D9E2', fontSize: typography.body }}
                >
                  {t('gamePrivateQuestBody')}
                </Text>
                <PrimaryButton
                  label={t('gameShowQuestChoices')}
                  disabled={!interactive}
                  onPress={() => {
                    setQuestChoicesVisible(true);
                  }}
                />
              </>
            ) : (
              <>
                {table.requiredQuestFails === 2 ? (
                  <Text
                    selectable
                    style={{
                      color: '#FFFFFF',
                      fontSize: typography.body,
                      fontWeight: '900',
                    }}
                  >
                    {t('gameTwoFailsNotice')}
                  </Text>
                ) : null}
                {table.allowedQuestChoices.includes('SUCCESS') ? (
                  <PrimaryButton
                    label={t('gameQuestSuccessChoice')}
                    disabled={!interactive}
                    onPress={() => {
                      setConfirmation({ type: 'QUEST', choice: 'SUCCESS' });
                    }}
                  />
                ) : null}
                {table.allowedQuestChoices.includes('FAIL') ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={!interactive}
                    onPress={() => {
                      setConfirmation({ type: 'QUEST', choice: 'FAIL' });
                    }}
                    style={({ pressed }) => ({
                      minHeight: touchTarget.minimum,
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: spacing.md,
                      borderRadius: 16,
                      borderCurve: 'continuous',
                      borderWidth: 2,
                      borderColor: color.action.destructive,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text
                      selectable
                      style={{
                        color: '#FFFFFF',
                        fontSize: typography.body,
                        fontWeight: '900',
                      }}
                    >
                      {t('gameQuestFailureChoice')}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </Card>
        ) : (
          <Card backgroundColor={color.surface.card}>
            <Heading>{t('gameWaitingQuestTeam')}</Heading>
            <Text
              selectable
              style={{ color: color.text.secondary, fontSize: typography.body }}
            >
              {t('gameWaitingQuestTeamBody')}
            </Text>
          </Card>
        )
      ) : null}

      {table.phase === 'QUEST_RESOLUTION' && latestQuest !== undefined ? (
        <Card backgroundColor={color.surface.card}>
          <Heading>
            {latestQuest.result === 'SUCCESS'
              ? t('gameQuestSucceeded')
              : t('gameQuestFailed')}
          </Heading>
          <Text
            selectable
            style={{
              color: color.text.primary,
              fontSize: 24,
              fontWeight: '900',
              fontVariant: ['tabular-nums'],
            }}
          >
            {t('gameQuestVoteSummary', {
              successes: latestQuest.successChoices,
              failures: latestQuest.failChoices,
            })}
          </Text>
          <Text
            selectable
            style={{ color: color.text.secondary, fontSize: typography.body }}
          >
            {t('gameQuestThreshold', {
              requiredFails: latestQuest.requiredFails,
            })}
          </Text>
          {table.outcomeReason === undefined ? null : (
            <Text
              accessibilityLiveRegion="assertive"
              selectable
              style={{
                color: color.result.failure,
                fontSize: typography.body,
                fontWeight: '900',
              }}
            >
              {t(
                mappedMessageKey(
                  OUTCOME_REASON_KEYS,
                  table.outcomeReason,
                  'outcomeEnded',
                ),
              )}
            </Text>
          )}
          {table.canContinue && table.continueAction !== undefined ? (
            <PrimaryButton
              label={t(CONTINUE_ACTION_KEYS[table.continueAction])}
              busy={commands.pendingCommandType === 'ContinuePhase'}
              disabled={!interactive}
              onPress={() => void commands.continuePhase()}
            />
          ) : null}
        </Card>
      ) : null}

      {table.phase === 'ASSASSINATION' ? (
        <Card backgroundColor={color.surface.card}>
          <Heading>{t('assassinationThreeSuccesses')}</Heading>
          <Text
            selectable
            style={{ color: color.text.secondary, fontSize: typography.body }}
          >
            {t('gameAssassinationBody')}
          </Text>
          {table.canContinue && table.continueAction !== undefined ? (
            <PrimaryButton
              label={t(CONTINUE_ACTION_KEYS[table.continueAction])}
              busy={commands.pendingCommandType === 'ContinuePhase'}
              disabled={!interactive}
              onPress={() => void commands.continuePhase()}
            />
          ) : null}
        </Card>
      ) : null}

      {table.phase === 'GAME_OVER' ? (
        <Card backgroundColor={color.surface.card}>
          <Heading>{t('gameRulingLocked')}</Heading>
          <Text
            accessibilityLiveRegion="assertive"
            selectable
            style={{
              color: color.text.primary,
              fontSize: typography.body,
              fontWeight: '900',
            }}
          >
            {table.outcomeReason === undefined
              ? t('outcomeEnded')
              : t(
                  mappedMessageKey(
                    OUTCOME_REASON_KEYS,
                    table.outcomeReason,
                    'outcomeEnded',
                  ),
                )}
          </Text>
          <Text
            selectable
            style={{ color: color.text.secondary, fontSize: typography.body }}
          >
            {t('gameRulingPrivacy')}
          </Text>
        </Card>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: historyExpanded }}
        onPress={() => {
          setHistoryExpanded((current) => !current);
        }}
        style={({ pressed }) => ({
          minHeight: touchTarget.minimum,
          justifyContent: 'center',
          padding: spacing.md,
          borderRadius: 16,
          borderCurve: 'continuous',
          backgroundColor: color.surface.card,
          opacity: pressed ? 0.72 : 1,
        })}
      >
        <Text
          selectable
          style={{
            color: color.text.primary,
            fontSize: typography.body,
            fontWeight: '900',
          }}
        >
          {historyExpanded ? t('gameCollapseHistory') : t('gameExpandHistory')}
        </Text>
      </Pressable>
      {historyExpanded ? (
        <Card backgroundColor={color.surface.card}>
          <Heading>{t('gamePublicHistory')}</Heading>
          {table.proposalHistory.length === 0 &&
          table.questHistory.length === 0 ? (
            <Text
              selectable
              style={{ color: color.text.secondary, fontSize: typography.body }}
            >
              {t('gameNoPublicHistory')}
            </Text>
          ) : null}
          {table.proposalHistory.map((proposal) => {
            const leader = table.players.find(
              (player) => player.playerId === proposal.leaderPlayerId,
            );
            return (
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
                    leader: leader?.nickname ?? '—',
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
                      .flatMap((playerId) => {
                        const player = table.players.find(
                          (candidate) => candidate.playerId === playerId,
                        );
                        return player === undefined
                          ? []
                          : [seatPlayerLabel(player.seat, player.nickname)];
                      })
                      .join(t('commonListSeparator')),
                  })}
                </Text>
                {proposal.votes.map((vote) => {
                  const player = table.players.find(
                    (candidate) => candidate.playerId === vote.playerId,
                  );
                  return (
                    <Text
                      key={`${String(proposal.questIndex)}-${String(proposal.proposalAttempt)}-${vote.playerId}`}
                      selectable
                      style={{
                        color: color.text.secondary,
                        fontSize: typography.supporting,
                      }}
                    >
                      {t('historyVote', {
                        player:
                          player === undefined
                            ? t('commonUnknownPlayer')
                            : seatPlayerLabel(player.seat, player.nickname),
                        vote:
                          vote.vote === 'APPROVE'
                            ? t('commonApprove')
                            : t('commonReject'),
                      })}
                    </Text>
                  );
                })}
              </View>
            );
          })}
          {table.questHistory.map((quest) => (
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
                {t('gameHistoryQuestActions', {
                  successes: quest.successChoices,
                  failures: quest.failChoices,
                  requiredFails: quest.requiredFails,
                })}
              </Text>
              <Text
                selectable
                style={{
                  color: color.text.secondary,
                  fontSize: typography.supporting,
                }}
              >
                {t('gameApprovedTeam', {
                  players: quest.teamPlayerIds
                    .flatMap((playerId) => {
                      const player = table.players.find(
                        (candidate) => candidate.playerId === playerId,
                      );
                      return player === undefined
                        ? []
                        : [seatPlayerLabel(player.seat, player.nickname)];
                    })
                    .join(t('commonListSeparator')),
                })}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      {commands.notice === undefined ? null : (
        <Text
          accessibilityLiveRegion="polite"
          selectable
          style={{ color: color.result.success, fontSize: typography.body }}
        >
          {commands.notice}
        </Text>
      )}
      {session.error === undefined ? null : (
        <View style={{ gap: spacing.sm }}>
          <Text
            accessibilityLiveRegion="assertive"
            selectable
            style={{ color: color.result.failure, fontSize: typography.body }}
          >
            {session.error}
          </Text>
          <PrimaryButton
            label={t('commonResync')}
            disabled={busy}
            onPress={() => void session.refreshView()}
          />
        </View>
      )}

      <ConfirmationModal
        busy={busy}
        confirmLabel={confirmationContent.confirmLabel}
        description={confirmationContent.description}
        onCancel={() => {
          setConfirmation(undefined);
        }}
        onConfirm={() => void submitConfirmation()}
        title={confirmationContent.title}
        visible={confirmation !== undefined}
      />
    </PageShell>
  );
}

import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';

import { PageShell } from '@/components/page-shell';
import { PrimaryButton } from '@/components/primary-button';
import { useI18n } from '@/localization/localization-provider';
import { useSession } from '@/session/session-provider';
import { spacing, touchTarget, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';
import { RoleGuideControl } from '@/features/roles/role-guide-control';

import { deriveAssassinationState } from './assassination-state';
import { ConfirmationModal } from './confirmation-modal';
import { useGameCommands } from './use-game-commands';

export function AssassinationScreen() {
  const { color } = useAppTheme();
  const { t } = useI18n();
  const session = useSession();
  const commands = useGameCommands();
  const roomView = session.roomView;
  const state = useMemo(
    () =>
      roomView?.public.phase === 'ASSASSINATION'
        ? deriveAssassinationState(roomView)
        : undefined,
    [roomView],
  );
  const [targetPlayerId, setTargetPlayerId] = useState<string>();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const phase = roomView?.public.phase;
    if (phase === undefined || phase === 'ASSASSINATION') return;
    if (phase === 'LOBBY') router.replace('/lobby');
    else if (phase === 'ROLE_REVEAL') router.replace('/role');
    else if (phase === 'GAME_OVER')
      router.replace(
        roomView?.public.gameOutcome?.reason === 'ABORTED' ? '/' : '/result',
      );
    else router.replace('/game');
  }, [roomView?.public.gameOutcome?.reason, roomView?.public.phase]);

  useEffect(() => {
    setTargetPlayerId(undefined);
    setConfirming(false);
  }, [
    roomView?.public.phaseStage,
    roomView?.public.stateVersion,
    session.resyncEpoch,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        setTargetPlayerId(undefined);
        setConfirming(false);
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);

  if (roomView === undefined || state === undefined) {
    return (
      <PageShell>
        <Stack.Screen options={{ title: t('navAssassination') }} />
        <Text
          accessibilityRole="header"
          selectable
          style={{ color: color.text.primary, fontSize: typography.title }}
        >
          {t('assassinationSyncing')}
        </Text>
      </PageShell>
    );
  }

  const selected = state.targets.find(
    (player) => player.playerId === targetPlayerId,
  );
  const busy = commands.pendingCommandType !== undefined;
  const interactive = session.status === 'CONNECTED' && !busy;

  const submitTarget = async () => {
    if (targetPlayerId === undefined) return;
    const submitted = await commands.selectMerlinTarget(targetPlayerId);
    if (submitted) setTargetPlayerId(undefined);
    setConfirming(false);
  };

  return (
    <PageShell>
      <Stack.Screen
        options={{
          title: t('navAssassination'),
          headerBackVisible: false,
          gestureEnabled: false,
        }}
      />

      <View style={{ gap: spacing.sm }}>
        <Text
          accessibilityRole="header"
          selectable
          style={{
            color: color.text.primary,
            fontSize: typography.title,
            fontWeight: '900',
          }}
        >
          {t('assassinationThreeSuccesses')}
        </Text>
        <Text
          selectable
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          {t('assassinationDiscussion')}
        </Text>
      </View>

      <RoleGuideControl
        roleId={roomView.private.selfRole}
        resetKey={`${String(session.resyncEpoch)}:${roomView.public.phase}`}
      />

      {state.phaseStage === 'HOST_HELD' ? (
        <View
          style={{
            gap: spacing.md,
            padding: spacing.lg,
            borderRadius: 18,
            borderCurve: 'continuous',
            backgroundColor: color.surface.blocking,
          }}
        >
          <Text
            accessibilityRole="header"
            selectable
            style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '900' }}
          >
            {t('assassinationWaitingDiscussion')}
          </Text>
          <Text
            selectable
            style={{ color: '#D5D9E2', fontSize: typography.body }}
          >
            {t('assassinationWaitingDiscussionBody')}
          </Text>
          {state.canContinue ? (
            <PrimaryButton
              label={t('assassinationOpenSelection')}
              busy={commands.pendingCommandType === 'ContinuePhase'}
              disabled={!interactive}
              onPress={() => void commands.continuePhase()}
            />
          ) : null}
        </View>
      ) : state.canSelectTarget ? (
        <View
          style={{
            gap: spacing.md,
            padding: spacing.lg,
            borderRadius: 18,
            borderCurve: 'continuous',
            backgroundColor: color.surface.private,
          }}
        >
          <Text
            accessibilityRole="header"
            selectable
            style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '900' }}
          >
            {t('assassinationPrivateSelection')}
          </Text>
          <Text
            selectable
            style={{ color: '#D5D9E2', fontSize: typography.body }}
          >
            {t('assassinationPrivateSelectionBody')}
          </Text>
          {state.targets.map((player) => {
            const isSelected = player.playerId === targetPlayerId;
            return (
              <Pressable
                accessibilityLabel={t('commonSeatAccessibility', {
                  seat: player.seat + 1,
                  nickname: player.nickname,
                })}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
                disabled={!interactive}
                key={player.playerId}
                onPress={() => {
                  setTargetPlayerId(player.playerId);
                }}
                style={({ pressed }) => ({
                  minHeight: touchTarget.minimum,
                  justifyContent: 'center',
                  padding: spacing.md,
                  borderRadius: 14,
                  borderCurve: 'continuous',
                  borderWidth: 2,
                  borderColor: isSelected
                    ? color.action.selected
                    : color.action.disabled,
                  backgroundColor: isSelected ? '#303642' : '#20242E',
                  opacity: pressed ? 0.72 : 1,
                })}
              >
                <Text
                  selectable
                  style={{
                    color: '#FFFFFF',
                    fontSize: typography.body,
                    fontWeight: '800',
                  }}
                >
                  {t('resultPlayerTitle', {
                    seat: player.seat + 1,
                    nickname: player.nickname,
                    targetSuffix: '',
                  })}
                </Text>
              </Pressable>
            );
          })}
          <PrimaryButton
            label={t('assassinationConfirmTarget')}
            disabled={!interactive || selected === undefined}
            onPress={() => {
              setConfirming(true);
            }}
          />
        </View>
      ) : (
        <View
          style={{
            gap: spacing.md,
            padding: spacing.lg,
            borderRadius: 18,
            borderCurve: 'continuous',
            backgroundColor: color.surface.card,
          }}
        >
          <Text
            accessibilityRole="header"
            selectable
            style={{
              color: color.text.primary,
              fontSize: 20,
              fontWeight: '900',
            }}
          >
            {t('assassinationWaiting')}
          </Text>
          <Text
            selectable
            style={{ color: color.text.secondary, fontSize: typography.body }}
          >
            {t('assassinationWaitingBody')}
          </Text>
        </View>
      )}

      <ConfirmationModal
        visible={confirming && selected !== undefined}
        title={t('assassinationConfirmFinalTitle')}
        description={t('assassinationConfirmFinalBody', {
          nickname: selected?.nickname ?? '',
        })}
        confirmLabel={t('assassinationConfirmFinal')}
        busy={commands.pendingCommandType === 'SelectMerlinTarget'}
        onCancel={() => {
          if (!busy) setConfirming(false);
        }}
        onConfirm={() => void submitTarget()}
      />
    </PageShell>
  );
}

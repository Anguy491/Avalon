import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import {
  AccessibilityInfo,
  Alert,
  AppState,
  findNodeHandle,
  Pressable,
  Text,
  View,
} from 'react-native';

import { PageShell } from '@/components/page-shell';
import { PrimaryButton } from '@/components/primary-button';
import {
  ALIGNMENT_KEYS,
  KNOWLEDGE_LABEL_KEYS,
  mappedMessageKey,
  ROLE_ABILITY_KEYS,
  ROLE_NAME_KEYS,
} from '@/localization/game-messages';
import { useI18n } from '@/localization/localization-provider';
import { useSession } from '@/session/session-provider';
import { spacing, touchTarget, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

import {
  INITIAL_PRIVACY_GATE,
  deriveRoleRevealUiState,
  isRoleRevealed,
  privacyGateReducer,
  roleRevealRedirectForPhase,
} from './role-reveal-state';
import { RoleGuideControl } from './role-guide-control';
import { useRoleCommands } from './use-role-commands';

export function RoleRevealScreen() {
  const { color } = useAppTheme();
  const { t } = useI18n();
  const session = useSession();
  const commands = useRoleCommands();
  const [privacy, dispatchPrivacy] = useReducer(
    privacyGateReducer,
    INITIAL_PRIVACY_GATE,
  );
  const roleHeading = useRef<Text | null>(null);
  const roomView = session.roomView;
  const roleState = useMemo(
    () =>
      roomView === undefined ? undefined : deriveRoleRevealUiState(roomView),
    [roomView],
  );
  const revealed = isRoleRevealed(privacy);
  const busy = commands.pendingCommandType !== undefined;
  const interactive = session.status === 'CONNECTED' && !busy;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') dispatchPrivacy({ type: 'conceal' });
    });
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (roleState?.hasSubmitted === true) {
      dispatchPrivacy({ type: 'acknowledged' });
    }
  }, [roleState?.hasSubmitted]);

  useEffect(() => {
    dispatchPrivacy({ type: 'conceal' });
  }, [session.resyncEpoch]);

  useEffect(() => {
    const phase = roomView?.public.phase;
    if (phase === undefined) return;
    if (
      phase === 'GAME_OVER' &&
      roomView?.public.gameOutcome?.reason === 'ABORTED'
    ) {
      router.replace('/');
      return;
    }
    const redirect = roleRevealRedirectForPhase(phase);
    if (redirect !== undefined) router.replace(redirect);
  }, [roomView?.public.gameOutcome?.reason, roomView?.public.phase]);

  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => {
      const node = findNodeHandle(roleHeading.current);
      if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [revealed]);

  const confirmAcknowledge = () => {
    Alert.alert(t('roleConfirmAlertTitle'), t('roleConfirmAlertBody'), [
      { text: t('roleKeepViewing'), style: 'cancel' },
      {
        text: t('roleConfirmRemembered'),
        onPress: () => {
          dispatchPrivacy({ type: 'conceal' });
          void commands.acknowledgeRole();
        },
      },
    ]);
  };

  if (roomView === undefined || roleState === undefined) {
    return (
      <PageShell contentStyle={{ backgroundColor: color.surface.private }}>
        <Stack.Screen
          options={{
            title: t('rolePrivateTitle'),
            headerStyle: { backgroundColor: color.surface.private },
            headerTintColor: color.text.inverse,
          }}
        />
        <Text
          accessibilityRole="header"
          style={{ color: color.text.inverse, fontSize: typography.title }}
        >
          {t('roleRecoveringTitle')}
        </Text>
        <Text style={{ color: '#D5D9E2', fontSize: typography.body }}>
          {t('roleRecoveringBody')}
        </Text>
        <PrimaryButton
          label={t('commonResync')}
          onPress={() => void session.refreshView()}
        />
      </PageShell>
    );
  }

  const secretAvailable =
    roleState.roleId !== undefined &&
    roleState.alignment !== null &&
    roleState.alignment !== undefined;
  const showSecret = revealed && secretAvailable && !roleState.hasSubmitted;

  return (
    <PageShell contentStyle={{ backgroundColor: color.surface.private }}>
      <Stack.Screen
        options={{
          title: t('rolePrivateTitle'),
          headerBackVisible: false,
          gestureEnabled: false,
          headerStyle: { backgroundColor: color.surface.private },
          headerTintColor: color.text.inverse,
        }}
      />

      <View
        accessible
        accessibilityLabel={t('roleProgressAccessibility', {
          submitted: roleState.submittedCount,
          required: roleState.requiredCount,
        })}
        style={{
          gap: spacing.xs,
          padding: spacing.md,
          borderRadius: 16,
          borderCurve: 'continuous',
          backgroundColor: color.surface.blocking,
        }}
      >
        <Text
          style={{
            color: color.text.inverse,
            fontSize: typography.body,
            fontWeight: '800',
          }}
        >
          {t('roleProgressTitle')}
        </Text>
        <Text
          accessibilityLiveRegion="polite"
          style={{
            color: '#D5D9E2',
            fontSize: typography.body,
            fontVariant: ['tabular-nums'],
          }}
        >
          {roleState.submittedCount} / {roleState.requiredCount}
        </Text>
        <Text style={{ color: '#D5D9E2', fontSize: typography.supporting }}>
          {t('roleProgressPrivacy')}
        </Text>
      </View>

      {roleState.hasSubmitted ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            gap: spacing.sm,
            padding: spacing.lg,
            borderRadius: 18,
            borderCurve: 'continuous',
            backgroundColor: color.surface.blocking,
          }}
        >
          <Text
            accessibilityRole="header"
            style={{
              color: color.text.inverse,
              fontSize: typography.title,
              fontWeight: '800',
            }}
          >
            {t('roleConfirmedTitle')}
          </Text>
          <Text style={{ color: '#D5D9E2', fontSize: typography.body }}>
            {t('roleConfirmedBody')}
          </Text>
        </View>
      ) : (
        <>
          <Pressable
            accessible={false}
            delayLongPress={600}
            onLongPress={() => {
              if (secretAvailable) dispatchPrivacy({ type: 'hold-reveal' });
            }}
            onPressOut={() => {
              dispatchPrivacy({ type: 'hold-release' });
            }}
            style={{
              gap: showSecret ? spacing.lg : spacing.md,
              padding: spacing.lg,
              borderRadius: 18,
              borderCurve: 'continuous',
              backgroundColor: showSecret ? '#0B0D12' : color.surface.blocking,
            }}
          >
            {showSecret ? (
              <>
                <View style={{ gap: spacing.sm }}>
                  <Text
                    ref={roleHeading}
                    accessibilityRole="header"
                    style={{
                      color: '#FFFFFF',
                      fontSize: 34,
                      fontWeight: '900',
                    }}
                  >
                    {t(
                      mappedMessageKey(
                        ROLE_NAME_KEYS,
                        roleState.roleId,
                        'commonUnknownRole',
                      ),
                    )}
                  </Text>
                  <Text
                    style={{
                      color:
                        roomView.private.selfAlignment === 'GOOD'
                          ? '#8ED5C5'
                          : '#FF9EA5',
                      fontSize: 20,
                      fontWeight: '800',
                    }}
                  >
                    {t(
                      mappedMessageKey(
                        ALIGNMENT_KEYS,
                        roleState.alignment,
                        'commonUnknownAlignment',
                      ),
                    )}
                  </Text>
                  <Text style={{ color: '#E8EBF2', fontSize: typography.body }}>
                    {t(
                      mappedMessageKey(
                        ROLE_ABILITY_KEYS,
                        roleState.roleId,
                        'roleMissing',
                      ),
                    )}
                  </Text>
                </View>

                <View style={{ gap: spacing.sm }}>
                  <Text
                    accessibilityRole="header"
                    style={{
                      color: '#FFFFFF',
                      fontSize: 20,
                      fontWeight: '800',
                    }}
                  >
                    {t('roleKnowledgeTitle')}
                  </Text>
                  {roleState.knowledgeItems.length === 0 ? (
                    <Text
                      style={{ color: '#D5D9E2', fontSize: typography.body }}
                    >
                      {t('roleNoKnowledge')}
                    </Text>
                  ) : (
                    roleState.knowledgeItems.map((item) => (
                      <View
                        key={`${item.playerId}:${item.knowledgeLabel}`}
                        accessibilityLabel={`${t(KNOWLEDGE_LABEL_KEYS[item.knowledgeLabel])}, ${item.playerName || t('commonTablePlayer')}`}
                        style={{
                          minHeight: touchTarget.minimum,
                          gap: spacing.xs,
                          padding: spacing.md,
                          borderRadius: 14,
                          borderCurve: 'continuous',
                          backgroundColor: '#20242E',
                        }}
                      >
                        <Text
                          style={{
                            color: '#FFFFFF',
                            fontSize: typography.body,
                            fontWeight: '800',
                          }}
                        >
                          {item.playerName || t('commonTablePlayer')}
                        </Text>
                        <Text
                          style={{
                            color: '#D5D9E2',
                            fontSize: typography.supporting,
                          }}
                        >
                          {t(KNOWLEDGE_LABEL_KEYS[item.knowledgeLabel])}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              </>
            ) : (
              <>
                <Text
                  accessibilityRole="header"
                  style={{
                    color: color.text.inverse,
                    fontSize: typography.title,
                    fontWeight: '800',
                  }}
                >
                  {t('rolePrivateInformation')}
                </Text>
                <Text style={{ color: '#D5D9E2', fontSize: typography.body }}>
                  {t('rolePrivacyInstructions')}
                </Text>
                {secretAvailable ? (
                  <View
                    accessibilityLabel={t('roleHoldAccessibility')}
                    accessibilityHint={t('roleHoldHint')}
                    style={{
                      minHeight: 64,
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: spacing.md,
                      borderRadius: 16,
                      borderCurve: 'continuous',
                      borderWidth: 2,
                      borderColor: color.action.selected,
                      backgroundColor: '#20242E',
                    }}
                  >
                    <Text
                      style={{
                        color: '#FFFFFF',
                        fontSize: typography.body,
                        fontWeight: '800',
                      }}
                    >
                      {t('roleHoldLabel')}
                    </Text>
                  </View>
                ) : (
                  <Text
                    accessibilityLiveRegion="assertive"
                    style={{ color: '#FFB2B8', fontSize: typography.body }}
                  >
                    {t('roleMissing')}
                  </Text>
                )}
              </>
            )}
          </Pressable>
          {showSecret ? (
            <RoleGuideControl
              roleId={roleState.roleId}
              available={roomView.public.phase !== 'PAUSED'}
              resetKey={`${String(session.resyncEpoch)}:${roomView.public.phase}`}
            />
          ) : null}
          {secretAvailable && privacy.mode !== 'HOLD' ? (
            <PrimaryButton
              label={showSecret ? t('roleHide') : t('roleTapReveal')}
              accessibilityHint={t('roleTapRevealHint')}
              onPress={() => {
                dispatchPrivacy({ type: 'toggle-reveal' });
              }}
            />
          ) : null}
        </>
      )}

      {privacy.hasViewed &&
      !roleState.hasSubmitted &&
      roleState.canAcknowledge ? (
        <PrimaryButton
          label={t('roleRemember')}
          busy={commands.pendingCommandType === 'AckRole'}
          disabled={!interactive}
          accessibilityHint={t('roleRememberHint')}
          onPress={confirmAcknowledge}
        />
      ) : null}

      {roleState.canContinue ? (
        <PrimaryButton
          label={t('roleStartConfirmation')}
          busy={commands.pendingCommandType === 'ContinuePhase'}
          disabled={!interactive}
          accessibilityHint={t('roleStartConfirmationHint')}
          onPress={() => void commands.continuePhase()}
        />
      ) : null}

      {!roleState.canAcknowledge &&
      !roleState.canContinue &&
      !roleState.hasSubmitted ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: '#D5D9E2', fontSize: typography.body }}
        >
          {t('roleWaitingHost')}
        </Text>
      ) : null}

      {commands.notice === undefined ? null : (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: '#8ED5C5', fontSize: typography.body }}
        >
          {commands.notice}
        </Text>
      )}
      {session.error === undefined ? null : (
        <View style={{ gap: spacing.sm }}>
          <Text
            accessibilityLiveRegion="assertive"
            style={{ color: '#FFB2B8', fontSize: typography.body }}
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

      <Text style={{ color: '#9FA7B6', fontSize: typography.supporting }}>
        {t('rolePrivacyFooter')}
      </Text>
    </PageShell>
  );
}

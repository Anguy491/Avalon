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
    Alert.alert(
      '确认已记住身份？',
      '提交后会立即隐藏私密内容，且本轮不能重复确认。',
      [
        { text: '继续查看', style: 'cancel' },
        {
          text: '确认已记住',
          onPress: () => {
            dispatchPrivacy({ type: 'conceal' });
            void commands.acknowledgeRole();
          },
        },
      ],
    );
  };

  if (roomView === undefined || roleState === undefined) {
    return (
      <PageShell contentStyle={{ backgroundColor: color.surface.private }}>
        <Stack.Screen
          options={{
            title: '私密身份',
            headerStyle: { backgroundColor: color.surface.private },
            headerTintColor: color.text.inverse,
          }}
        />
        <Text
          accessibilityRole="header"
          style={{ color: color.text.inverse, fontSize: typography.title }}
        >
          正在安全恢复身份投影
        </Text>
        <Text style={{ color: '#D5D9E2', fontSize: typography.body }}>
          恢复完成前不会显示任何缓存角色，也不会开放确认操作。
        </Text>
        <PrimaryButton
          label="重新同步"
          onPress={() => void session.refreshView()}
        />
      </PageShell>
    );
  }

  const secretAvailable =
    roleState.roleId !== undefined &&
    roleState.roleLabel !== undefined &&
    roleState.alignmentLabel !== undefined;
  const showSecret = revealed && secretAvailable && !roleState.hasSubmitted;

  return (
    <PageShell contentStyle={{ backgroundColor: color.surface.private }}>
      <Stack.Screen
        options={{
          title: '私密身份',
          headerBackVisible: false,
          gestureEnabled: false,
          headerStyle: { backgroundColor: color.surface.private },
          headerTintColor: color.text.inverse,
        }}
      />

      <View
        accessible
        accessibilityLabel={`身份确认进度 ${String(roleState.submittedCount)} / ${String(roleState.requiredCount)}`}
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
          身份确认进度
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
          只显示确认总数，不显示尚未确认的玩家。
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
            身份已确认
          </Text>
          <Text style={{ color: '#D5D9E2', fontSize: typography.body }}>
            私密内容已隐藏。请把手机保持在中性等待画面，等待其他玩家完成确认。
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
                    {roleState.roleLabel}
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
                    {roleState.alignmentLabel}
                  </Text>
                  <Text style={{ color: '#E8EBF2', fontSize: typography.body }}>
                    {roleState.ability}
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
                    你知道的信息
                  </Text>
                  {roleState.knowledgeItems.length === 0 ? (
                    <Text
                      style={{ color: '#D5D9E2', fontSize: typography.body }}
                    >
                      你没有额外的开局玩家信息。
                    </Text>
                  ) : (
                    roleState.knowledgeItems.map((item) => (
                      <View
                        key={`${item.playerId}:${item.label}`}
                        accessibilityLabel={`${item.label}，${item.playerName}`}
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
                          {item.playerName}
                        </Text>
                        <Text
                          style={{
                            color: '#D5D9E2',
                            fontSize: typography.supporting,
                          }}
                        >
                          {item.label}
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
                  私密信息
                </Text>
                <Text style={{ color: '#D5D9E2', fontSize: typography.body }}>
                  请遮挡屏幕并确认旁人无法看到。应用进入后台后会立即恢复此遮罩。
                </Text>
                {secretAvailable ? (
                  <View
                    accessibilityLabel="按住查看身份"
                    accessibilityHint="持续按住六百毫秒后显示，松开立即隐藏"
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
                      按住 600 毫秒查看身份
                    </Text>
                  </View>
                ) : (
                  <Text
                    accessibilityLiveRegion="assertive"
                    style={{ color: '#FFB2B8', fontSize: typography.body }}
                  >
                    当前投影缺少本人身份，请重新同步后再查看。
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
              label={showSecret ? '隐藏身份' : '使用点按揭示'}
              accessibilityHint="为屏幕阅读器和无法持续按住的用户提供等价操作"
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
          label="我已记住身份"
          busy={commands.pendingCommandType === 'AckRole'}
          disabled={!interactive}
          accessibilityHint="确认后立即隐藏身份且不能重复提交"
          onPress={confirmAcknowledge}
        />
      ) : null}

      {roleState.canContinue ? (
        <PrimaryButton
          label="开始全员身份确认"
          busy={commands.pendingCommandType === 'ContinuePhase'}
          disabled={!interactive}
          accessibilityHint="房主开放所有玩家的身份确认按钮"
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
          等待房主开始身份确认。你仍可先私密查看并记住自己的身份。
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
            label="重新同步"
            disabled={busy}
            onPress={() => void session.refreshView()}
          />
        </View>
      )}

      <Text style={{ color: '#9FA7B6', fontSize: typography.supporting }}>
        身份内容不会提供复制、分享或导出入口。系统无法阻止主动拍摄屏幕，请注意同桌环境。
      </Text>
    </PageShell>
  );
}

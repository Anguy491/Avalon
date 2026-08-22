import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { PageShell } from '@/components/page-shell';
import { PrimaryButton } from '@/components/primary-button';
import { mappedMessageKey, ROLE_NAME_KEYS } from '@/localization/game-messages';
import { useI18n } from '@/localization/localization-provider';
import type { MessageKey } from '@/localization/messages';
import { useSession } from '@/session/session-provider';
import { spacing, touchTarget, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

import { LobbyConfigEditor, LobbySeatEditor } from './lobby-editors';
import { deriveLobbyUiState } from './lobby-state';
import { useLobbyCommands } from './use-lobby-commands';

const JOIN_HOST = process.env.EXPO_PUBLIC_JOIN_HOST ?? 'join.example.invalid';

function connectionMessageKey(
  status: ReturnType<typeof useSession>['status'],
): MessageKey {
  if (status === 'CONNECTED') return 'commonOnline';
  if (status === 'RECOVERING' || status === 'LOADING') {
    return 'commonRecovering';
  }
  return 'commonOffline';
}

function ActionButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  destructive = false,
  accessibilityHint,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly destructive?: boolean;
  readonly accessibilityHint?: string;
}) {
  const { color } = useAppTheme();
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={
        busy ? t('commonBusyAccessibility', { label }) : label
      }
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touchTarget.minimum,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: 14,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: destructive
          ? color.action.destructive
          : color.action.primary,
        backgroundColor: color.surface.card,
        opacity: disabled || busy ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      <Text
        selectable
        style={{
          color: destructive ? color.action.destructive : color.action.primary,
          fontSize: typography.body,
          fontWeight: '800',
        }}
      >
        {busy ? t('commonProcessing') : label}
      </Text>
    </Pressable>
  );
}

export function LobbyScreen() {
  const { color } = useAppTheme();
  const { t } = useI18n();
  const session = useSession();
  const commands = useLobbyCommands();
  const [showQr, setShowQr] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showSeats, setShowSeats] = useState(false);
  const [copied, setCopied] = useState(false);
  const roomView = session.roomView;
  const lobby = useMemo(
    () => (roomView === undefined ? undefined : deriveLobbyUiState(roomView)),
    [roomView],
  );
  const roomCode = roomView?.public.roomCode ?? session.summary?.roomCode;
  const joinLink =
    roomCode === undefined
      ? undefined
      : `https://${JOIN_HOST}/join/${roomCode}`;
  const busy = commands.pendingCommandType !== undefined;
  const interactive = session.status === 'CONNECTED' && !busy;

  useEffect(() => {
    if (session.status === 'ANONYMOUS') router.replace('/');
  }, [session.status]);

  useEffect(() => {
    const phase = roomView?.public.phase;
    if (phase === 'ROLE_REVEAL') router.replace('/role');
    else if (phase === 'ASSASSINATION') router.replace('/assassination');
    else if (phase === 'GAME_OVER') router.replace('/result');
    else if (phase !== undefined && phase !== 'LOBBY') router.replace('/game');
  }, [roomView?.public.phase]);

  useEffect(() => {
    if (lobby === undefined) return;
    if (!lobby.allowedActions.has('ConfigureRoom')) setShowConfig(false);
    if (!lobby.allowedActions.has('ReorderSeats')) setShowSeats(false);
  }, [lobby]);

  if (roomCode === undefined) {
    return (
      <PageShell>
        <Stack.Screen options={{ title: t('navLobby') }} />
        <Text
          selectable
          accessibilityRole="header"
          style={{ color: color.text.primary, fontSize: typography.title }}
        >
          {t('lobbyUnableToRestore')}
        </Text>
        <Text
          selectable
          accessibilityLiveRegion="polite"
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          {session.error ?? t('lobbyNoRecoverableSession')}
        </Text>
        <PrimaryButton
          label={t('commonReturnHome')}
          onPress={() => {
            router.replace('/');
          }}
        />
      </PageShell>
    );
  }

  const copyRoomCode = async () => {
    await Clipboard.setStringAsync(roomCode);
    setCopied(true);
  };

  const confirmKick = (playerId: string, nickname: string) => {
    Alert.alert(t('lobbyRemoveTitle', { nickname }), t('lobbyRemoveBody'), [
      { text: t('commonCancel'), style: 'cancel' },
      {
        text: t('lobbyConfirmRemove'),
        style: 'destructive',
        onPress: () => {
          void commands.kickPlayer(playerId);
        },
      },
    ]);
  };

  const confirmStart = () => {
    Alert.alert(t('lobbyStartTitle'), t('lobbyStartBody'), [
      { text: t('commonCancel'), style: 'cancel' },
      {
        text: t('lobbyConfirmStart'),
        onPress: () => {
          void commands.startGame();
        },
      },
    ]);
  };

  const confirmLeave = () => {
    Alert.alert(t('lobbyLeaveTitle'), t('lobbyLeaveBody'), [
      { text: t('commonCancel'), style: 'cancel' },
      {
        text: t('lobbyConfirmLeave'),
        style: 'destructive',
        onPress: () => {
          void commands.leaveLobby();
        },
      },
    ]);
  };

  const confirmClose = () => {
    Alert.alert(t('lobbyCloseTitle'), t('lobbyCloseBody'), [
      { text: t('commonCancel'), style: 'cancel' },
      {
        text: t('lobbyConfirmClose'),
        style: 'destructive',
        onPress: () => {
          void commands.closeRoom();
        },
      },
    ]);
  };

  return (
    <PageShell>
      <Stack.Screen options={{ title: t('navLobby') }} />
      <View style={{ gap: spacing.sm, alignItems: 'center' }}>
        <Text
          selectable
          accessibilityRole="header"
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          {t('lobbyRoomCode')}
        </Text>
        <Text
          selectable
          accessibilityLabel={t('lobbyRoomCodeAccessibility', {
            roomCode: roomCode.split('').join(' '),
          })}
          style={{
            color: color.text.primary,
            fontSize: 38,
            fontWeight: '900',
            letterSpacing: 8,
          }}
        >
          {roomCode}
        </Text>
        <Text
          selectable
          accessibilityLiveRegion="polite"
          style={{
            color: color.text.secondary,
            fontSize: typography.supporting,
          }}
        >
          {t('lobbyConnectionStatus', {
            status: t(connectionMessageKey(session.status)),
            copiedSuffix: copied ? t('lobbyCopiedSuffix') : '',
          })}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <ActionButton
          label={t('lobbyCopyRoomCode')}
          onPress={() => void copyRoomCode()}
        />
        <ActionButton
          label={t('lobbyShowQr')}
          onPress={() => {
            setShowQr(true);
          }}
        />
      </View>

      {roomView === undefined || lobby === undefined ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            gap: spacing.sm,
            padding: spacing.md,
            borderRadius: 14,
            borderCurve: 'continuous',
            backgroundColor: color.surface.blocking,
          }}
        >
          <Text
            selectable
            style={{ color: color.text.inverse, fontSize: typography.body }}
          >
            {t('lobbyWaitingProjection')}
          </Text>
          <PrimaryButton
            label={t('commonResync')}
            onPress={() => void session.refreshView()}
          />
        </View>
      ) : (
        <>
          <View style={{ gap: spacing.sm }}>
            <Text
              selectable
              accessibilityRole="header"
              style={{
                color: color.text.primary,
                fontSize: 22,
                fontWeight: '800',
              }}
            >
              {t('lobbyPlayers')}
            </Text>
            {lobby.players.map((player) => (
              <View
                key={player.playerId}
                accessibilityLabel={t('lobbyPlayerAccessibility', {
                  seat: player.seat + 1,
                  nickname: player.nickname,
                  hostSuffix: player.isHost ? t('lobbyHostSuffix') : '',
                  connection: player.connected
                    ? t('commonOnline')
                    : t('commonOffline'),
                  readiness: player.ready
                    ? t('commonReady')
                    : t('commonNotReady'),
                })}
                style={{
                  minHeight: touchTarget.minimum,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  padding: spacing.md,
                  borderRadius: 14,
                  borderCurve: 'continuous',
                  backgroundColor: color.surface.card,
                }}
              >
                <Text
                  selectable
                  style={{
                    color: color.action.primary,
                    fontSize: typography.body,
                    fontWeight: '900',
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {player.seat + 1}
                </Text>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text
                    selectable
                    style={{
                      color: color.text.primary,
                      fontSize: typography.body,
                      fontWeight: '700',
                    }}
                  >
                    {player.nickname} {player.isHost ? t('lobbyHostBadge') : ''}
                  </Text>
                  <Text
                    selectable
                    style={{
                      color: color.text.secondary,
                      fontSize: typography.supporting,
                    }}
                  >
                    {player.connected ? t('commonOnline') : t('commonOffline')}{' '}
                    · {player.ready ? t('commonReady') : t('commonNotReady')}
                  </Text>
                </View>
                {lobby.eligibleKickPlayers.some(
                  (candidate) => candidate.playerId === player.playerId,
                ) ? (
                  <ActionButton
                    label={t('lobbyRemovePlayer', {
                      nickname: player.nickname,
                    })}
                    destructive
                    busy={commands.pendingCommandType === 'KickLobbyPlayer'}
                    disabled={!interactive}
                    onPress={() => {
                      confirmKick(player.playerId, player.nickname);
                    }}
                  />
                ) : null}
              </View>
            ))}
          </View>

          <View
            style={{
              gap: spacing.sm,
              padding: spacing.md,
              borderRadius: 14,
              borderCurve: 'continuous',
              backgroundColor: color.surface.card,
            }}
          >
            <Text
              selectable
              accessibilityRole="header"
              style={{
                color: color.text.primary,
                fontSize: typography.body,
                fontWeight: '800',
              }}
            >
              {t('lobbyPublicSetup')}
            </Text>
            <Text
              selectable
              style={{ color: color.text.secondary, fontSize: typography.body }}
            >
              {t('lobbyPublicSetupSummary', {
                players: roomView.public.config.playerCount,
                roles: roomView.public.config.roleIds.length,
              })}
            </Text>
            <Text
              selectable
              style={{
                color: color.text.secondary,
                fontSize: typography.supporting,
              }}
            >
              {roomView.public.config.roleIds
                .map((roleId) =>
                  t(
                    mappedMessageKey(
                      ROLE_NAME_KEYS,
                      roleId,
                      'commonUnknownRole',
                    ),
                  ),
                )
                .join(' · ')}
            </Text>
          </View>

          {commands.notice === undefined ? null : (
            <Text
              selectable
              accessibilityLiveRegion="polite"
              style={{ color: color.result.success, fontSize: typography.body }}
            >
              {commands.notice}
            </Text>
          )}
          {session.error === undefined ? null : (
            <View style={{ gap: spacing.sm }}>
              <Text
                selectable
                accessibilityLiveRegion="assertive"
                style={{
                  color: color.result.failure,
                  fontSize: typography.body,
                }}
              >
                {session.error}
              </Text>
              <ActionButton
                label={t('lobbyResync')}
                disabled={busy}
                onPress={() => void session.refreshView()}
              />
            </View>
          )}

          <View style={{ gap: spacing.sm }}>
            {lobby.isHost ? (
              <>
                <PrimaryButton
                  label={t('lobbyStartGame')}
                  busy={commands.pendingCommandType === 'StartGame'}
                  disabled={
                    !interactive || !lobby.allowedActions.has('StartGame')
                  }
                  accessibilityHint={t('lobbyStartHint')}
                  onPress={confirmStart}
                />
                {lobby.allowedActions.has('StartGame') ? null : (
                  <Text
                    selectable
                    style={{
                      color: color.text.secondary,
                      fontSize: typography.supporting,
                    }}
                  >
                    {t('lobbyStartUnavailable')}
                  </Text>
                )}
              </>
            ) : null}
            {lobby.allowedActions.has('SetReady') &&
            lobby.self !== undefined ? (
              <PrimaryButton
                label={
                  lobby.self.ready ? t('lobbyCancelReady') : t('lobbyReady')
                }
                busy={commands.pendingCommandType === 'SetReady'}
                disabled={
                  !interactive && commands.pendingCommandType !== 'SetReady'
                }
                accessibilityHint={t('lobbyReadyHint')}
                onPress={() => void commands.setReady(!lobby.self?.ready)}
              />
            ) : null}
            {lobby.allowedActions.has('ConfigureRoom') ? (
              <ActionButton
                label={t('lobbyEditConfig')}
                disabled={!interactive}
                onPress={() => {
                  setShowConfig(true);
                }}
              />
            ) : null}
            {lobby.allowedActions.has('ReorderSeats') ? (
              <ActionButton
                label={t('lobbyAdjustSeats')}
                disabled={!interactive}
                onPress={() => {
                  setShowSeats(true);
                }}
              />
            ) : null}
            {lobby.allowedActions.has('LeaveLobby') ? (
              <ActionButton
                label={t('lobbyLeave')}
                destructive
                busy={commands.pendingCommandType === 'LeaveLobby'}
                disabled={!interactive}
                onPress={confirmLeave}
              />
            ) : null}
            {lobby.allowedActions.has('CloseRoom') ? (
              <ActionButton
                label={t('lobbyClose')}
                destructive
                busy={commands.pendingCommandType === 'CloseRoom'}
                disabled={!interactive}
                accessibilityHint={t('lobbyCloseHint')}
                onPress={confirmClose}
              />
            ) : null}
          </View>

          {roomView.public.phase === 'LOBBY' ? null : (
            <Text
              selectable
              accessibilityLiveRegion="polite"
              style={{ color: color.text.secondary, fontSize: typography.body }}
            >
              {t('lobbyPhaseChanged')}
            </Text>
          )}

          <LobbyConfigEditor
            visible={showConfig}
            config={roomView.public.config}
            busy={commands.pendingCommandType === 'ConfigureRoom'}
            onClose={() => {
              setShowConfig(false);
            }}
            onSave={async (config) => {
              if (await commands.configureRoom(config)) setShowConfig(false);
            }}
          />
          <LobbySeatEditor
            visible={showSeats}
            players={lobby.players}
            busy={commands.pendingCommandType === 'ReorderSeats'}
            onClose={() => {
              setShowSeats(false);
            }}
            onSave={async (playerIds) => {
              if (await commands.reorderSeats(playerIds)) setShowSeats(false);
            }}
          />
        </>
      )}

      <Modal
        visible={showQr}
        animationType="slide"
        onRequestClose={() => {
          setShowQr(false);
        }}
      >
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.xl,
            padding: spacing.lg,
            backgroundColor: '#FFFFFF',
          }}
        >
          <Text
            selectable
            accessibilityRole="header"
            style={{ color: '#171A22', fontSize: 32, fontWeight: '900' }}
          >
            {roomCode}
          </Text>
          {joinLink === undefined ? null : (
            <QRCode value={joinLink} size={260} backgroundColor="#FFFFFF" />
          )}
          <Text
            selectable
            style={{ color: '#5D6270', fontSize: typography.body }}
          >
            {t('lobbyQrPrivacy')}
          </Text>
          <PrimaryButton
            label={t('lobbyCloseQr')}
            onPress={() => {
              setShowQr(false);
            }}
          />
        </View>
      </Modal>
    </PageShell>
  );
}

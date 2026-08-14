import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { PageShell } from '@/components/page-shell';
import { PrimaryButton } from '@/components/primary-button';
import { useSession } from '@/session/session-provider';
import { spacing, touchTarget, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

import { LobbyConfigEditor, LobbySeatEditor } from './lobby-editors';
import { deriveLobbyUiState } from './lobby-state';
import { useLobbyCommands } from './use-lobby-commands';

const JOIN_HOST = process.env.EXPO_PUBLIC_JOIN_HOST ?? 'join.example.invalid';

function connectionLabel(status: ReturnType<typeof useSession>['status']) {
  if (status === 'CONNECTED') return '在线';
  if (status === 'RECOVERING' || status === 'LOADING') return '正在恢复';
  return '离线';
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
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={busy ? `${label}，正在处理` : label}
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
        {busy ? '正在处理…' : label}
      </Text>
    </Pressable>
  );
}

export function LobbyScreen() {
  const { color } = useAppTheme();
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
        <Stack.Screen options={{ title: '房间大厅' }} />
        <Text
          selectable
          accessibilityRole="header"
          style={{ color: color.text.primary, fontSize: typography.title }}
        >
          无法恢复房间
        </Text>
        <Text
          selectable
          accessibilityLiveRegion="polite"
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          {session.error ?? '本机没有可恢复的会话。'}
        </Text>
        <PrimaryButton
          label="返回首页"
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
    Alert.alert(
      `移除 ${nickname}？`,
      '移除后该玩家的大厅会话会失效，座次会压缩，并重置全员准备状态。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认移除',
          style: 'destructive',
          onPress: () => {
            void commands.kickPlayer(playerId);
          },
        },
      ],
    );
  };

  const confirmStart = () => {
    Alert.alert(
      '开始游戏并分配身份？',
      '开始后不能再修改座次或配置，也不能移除或替补玩家。请确认所有人已准备好私密查看身份。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认开始',
          onPress: () => {
            void commands.startGame();
          },
        },
      ],
    );
  };

  const confirmLeave = () => {
    Alert.alert('离开大厅？', '离开后本机会清除该房间会话。', [
      { text: '取消', style: 'cancel' },
      {
        text: '确认离开',
        style: 'destructive',
        onPress: () => {
          void commands.leaveLobby();
        },
      },
    ]);
  };

  const confirmClose = () => {
    Alert.alert(
      '关闭房间？',
      '所有大厅玩家都会断开，房间号会失效。此操作无法撤销。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认关闭房间',
          style: 'destructive',
          onPress: () => {
            void commands.closeRoom();
          },
        },
      ],
    );
  };

  return (
    <PageShell>
      <Stack.Screen options={{ title: '房间大厅' }} />
      <View style={{ gap: spacing.sm, alignItems: 'center' }}>
        <Text
          selectable
          accessibilityRole="header"
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          房间号
        </Text>
        <Text
          selectable
          accessibilityLabel={`房间号 ${roomCode.split('').join(' ')}`}
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
          连接状态：{connectionLabel(session.status)}
          {copied ? ' · 已复制房间号' : ''}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <ActionButton label="复制房间号" onPress={() => void copyRoomCode()} />
        <ActionButton
          label="显示二维码"
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
            正在等待最新大厅投影。离线期间不会开放任何房间操作。
          </Text>
          <PrimaryButton
            label="重新同步"
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
              玩家
            </Text>
            {lobby.players.map((player) => (
              <View
                key={player.playerId}
                accessibilityLabel={`座次 ${String(player.seat + 1)}，${player.nickname}${player.isHost ? '，房主' : ''}，${player.connected ? '在线' : '离线'}，${player.ready ? '已准备' : '未准备'}`}
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
                    {player.nickname} {player.isHost ? '· 房主' : ''}
                  </Text>
                  <Text
                    selectable
                    style={{
                      color: color.text.secondary,
                      fontSize: typography.supporting,
                    }}
                  >
                    {player.connected ? '在线' : '离线'} ·{' '}
                    {player.ready ? '已准备' : '未准备'}
                  </Text>
                </View>
                {lobby.eligibleKickPlayers.some(
                  (candidate) => candidate.playerId === player.playerId,
                ) ? (
                  <ActionButton
                    label={`移除 ${player.nickname}`}
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
              公开配置
            </Text>
            <Text
              selectable
              style={{ color: color.text.secondary, fontSize: typography.body }}
            >
              目标 {roomView.public.config.playerCount} 人 · 当前角色{' '}
              {roomView.public.config.roleIds.length} 个
            </Text>
            <Text
              selectable
              style={{
                color: color.text.secondary,
                fontSize: typography.supporting,
              }}
            >
              {roomView.public.config.roleIds.join(' · ')}
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
                label="重新同步大厅"
                disabled={busy}
                onPress={() => void session.refreshView()}
              />
            </View>
          )}

          <View style={{ gap: spacing.sm }}>
            {lobby.isHost ? (
              <>
                <PrimaryButton
                  label="开始游戏"
                  busy={commands.pendingCommandType === 'StartGame'}
                  disabled={
                    !interactive || !lobby.allowedActions.has('StartGame')
                  }
                  accessibilityHint="服务端仅在人数、连接、准备和配置条件全部满足时开放"
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
                    等待服务端确认人数、在线状态、全员准备和配置均满足开局条件。
                  </Text>
                )}
              </>
            ) : null}
            {lobby.allowedActions.has('SetReady') &&
            lobby.self !== undefined ? (
              <PrimaryButton
                label={lobby.self.ready ? '取消准备' : '我已准备'}
                busy={commands.pendingCommandType === 'SetReady'}
                disabled={
                  !interactive && commands.pendingCommandType !== 'SetReady'
                }
                accessibilityHint="只提交本人的准备状态"
                onPress={() => void commands.setReady(!lobby.self?.ready)}
              />
            ) : null}
            {lobby.allowedActions.has('ConfigureRoom') ? (
              <ActionButton
                label="编辑房间配置"
                disabled={!interactive}
                onPress={() => {
                  setShowConfig(true);
                }}
              />
            ) : null}
            {lobby.allowedActions.has('ReorderSeats') ? (
              <ActionButton
                label="调整座次"
                disabled={!interactive}
                onPress={() => {
                  setShowSeats(true);
                }}
              />
            ) : null}
            {lobby.allowedActions.has('LeaveLobby') ? (
              <ActionButton
                label="离开大厅"
                destructive
                busy={commands.pendingCommandType === 'LeaveLobby'}
                disabled={!interactive}
                onPress={confirmLeave}
              />
            ) : null}
            {lobby.allowedActions.has('CloseRoom') ? (
              <ActionButton
                label="关闭房间"
                destructive
                busy={commands.pendingCommandType === 'CloseRoom'}
                disabled={!interactive}
                accessibilityHint="关闭房间会使所有大厅会话失效"
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
              房间已离开大厅阶段，正在等待身份揭示页面接管。
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
            二维码只包含公开加入链接。请适当调高屏幕亮度。
          </Text>
          <PrimaryButton
            label="关闭二维码"
            onPress={() => {
              setShowQr(false);
            }}
          />
        </View>
      </Modal>
    </PageShell>
  );
}

import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { PageShell } from '@/components/page-shell';
import { PrimaryButton } from '@/components/primary-button';
import { useSession } from '@/session/session-provider';
import { spacing, touchTarget, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

const JOIN_HOST = process.env.EXPO_PUBLIC_JOIN_HOST ?? 'join.example.invalid';

function connectionLabel(status: ReturnType<typeof useSession>['status']) {
  if (status === 'CONNECTED') return '在线';
  if (status === 'RECOVERING' || status === 'LOADING') return '正在恢复';
  return '离线';
}

export function LobbyScreen() {
  const { color } = useAppTheme();
  const session = useSession();
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const roomCode =
    session.roomView?.public.roomCode ?? session.summary?.roomCode;
  const joinLink =
    roomCode === undefined
      ? undefined
      : `https://${JOIN_HOST}/join/${roomCode}`;

  if (roomCode === undefined) {
    return (
      <PageShell>
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

  return (
    <PageShell>
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
        <Pressable
          accessibilityLabel="复制房间号"
          accessibilityRole="button"
          onPress={() => void copyRoomCode()}
          style={{
            minHeight: touchTarget.minimum,
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 14,
            backgroundColor: color.surface.card,
          }}
        >
          <Text
            style={{ color: color.text.primary, fontSize: typography.body }}
          >
            复制房间号
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="打开全屏二维码"
          accessibilityRole="button"
          onPress={() => {
            setShowQr(true);
          }}
          style={{
            minHeight: touchTarget.minimum,
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 14,
            backgroundColor: color.surface.card,
          }}
        >
          <Text
            style={{ color: color.text.primary, fontSize: typography.body }}
          >
            显示二维码
          </Text>
        </Pressable>
      </View>

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
        {session.roomView === undefined ? (
          <View
            accessibilityLiveRegion="polite"
            style={{
              gap: spacing.sm,
              padding: spacing.md,
              borderRadius: 14,
              backgroundColor: color.surface.blocking,
            }}
          >
            <Text
              style={{ color: color.text.inverse, fontSize: typography.body }}
            >
              当前离线，正在等待最新大厅投影。不会显示缓存的私密信息。
            </Text>
            <PrimaryButton
              label="重试恢复"
              onPress={() => void session.recover()}
            />
          </View>
        ) : (
          session.roomView.public.players.map((player) => (
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
                backgroundColor: color.surface.card,
              }}
            >
              <Text
                style={{
                  color: color.action.primary,
                  fontSize: typography.body,
                  fontWeight: '900',
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
            </View>
          ))
        )}
      </View>

      <Text
        selectable
        style={{ color: color.text.secondary, fontSize: typography.supporting }}
      >
        M2 仅提供创建、加入与实时大厅投影；准备、改座次和开始游戏将在 M3 开放。
      </Text>

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

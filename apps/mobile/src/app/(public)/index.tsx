import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { ActionLink } from '@/components/action-link';
import { FormField } from '@/components/form-field';
import { PageShell } from '@/components/page-shell';
import { PrimaryButton } from '@/components/primary-button';
import { usePublicDraft } from '@/session/public-draft-provider';
import { useSession } from '@/session/session-provider';
import { terminalSessionDisposition } from '@/session/terminal-session-state';
import { spacing, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

export default function HomeScreen() {
  const { color } = useAppTheme();
  const draft = usePublicDraft();
  const session = useSession();

  useEffect(() => {
    const phase = session.roomView?.public.phase;
    const terminal = terminalSessionDisposition(session.roomView);
    if (terminal === 'RETURN_HOME') return;
    if (phase === 'LOBBY') router.replace('/lobby');
    else if (phase === 'ROLE_REVEAL') router.replace('/role');
    else if (phase === 'ASSASSINATION') router.replace('/assassination');
    else if (terminal === 'RETAIN_RESULT') router.replace('/result');
    else if (phase !== undefined) router.replace('/game');
  }, [session.roomView]);

  return (
    <PageShell>
      <Stack.Screen options={{ title: 'Avalon' }} />
      <View style={{ gap: spacing.sm, paddingTop: spacing.lg }}>
        <Text
          selectable
          accessibilityRole="header"
          style={{
            color: color.text.primary,
            fontSize: typography.title,
            fontWeight: '800',
          }}
        >
          让手机保管秘密
        </Text>
        <Text
          selectable
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          面向同桌 5–10 人的服务端权威阿瓦隆主持应用。
        </Text>
      </View>

      <FormField
        label="你的昵称"
        value={draft.nickname}
        onChangeText={draft.setNickname}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={48}
        placeholder="1–16 个可见字符"
        returnKeyType="done"
      />

      {session.status === 'LOADING' || session.status === 'RECOVERING' ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            gap: spacing.sm,
            padding: spacing.md,
            borderRadius: 16,
            backgroundColor: color.surface.blocking,
          }}
        >
          <Text
            style={{ color: color.text.inverse, fontSize: typography.body }}
          >
            正在恢复对局…
          </Text>
        </View>
      ) : null}

      {session.status === 'OFFLINE' && session.summary !== undefined ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            gap: spacing.md,
            padding: spacing.md,
            borderRadius: 16,
            backgroundColor: color.surface.card,
          }}
        >
          <Text
            style={{ color: color.text.primary, fontSize: typography.body }}
          >
            房间 {session.summary.roomCode}{' '}
            暂时无法恢复。你可以继续等待或清除本机会话。
          </Text>
          <PrimaryButton
            label="继续等待并重试"
            onPress={() => void session.recover()}
          />
          <PrimaryButton
            label="清除本机会话"
            onPress={() => void session.forgetSession()}
          />
        </View>
      ) : null}

      <View style={{ gap: spacing.md }}>
        <ActionLink
          href="/create"
          label="创建房间"
          description="选择人数与角色配置，成为房主"
          primary
        />
        <ActionLink
          href="/join"
          label="输入房间号"
          description="使用六位公开房间号加入"
        />
        <ActionLink
          href="/scan"
          label="扫描二维码"
          description="相机被拒绝时仍可改用房间号"
        />
      </View>

      <Text
        selectable
        style={{ color: color.text.secondary, fontSize: typography.supporting }}
      >
        昵称只用于当前房间；会话令牌不会进入链接、剪贴板或普通偏好存储。
      </Text>
    </PageShell>
  );
}

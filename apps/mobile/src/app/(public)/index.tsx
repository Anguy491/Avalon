import { Stack } from 'expo-router/stack';
import { Text, View } from 'react-native';

import { ActionLink } from '@/components/action-link';
import { PageShell } from '@/components/page-shell';
import { color, spacing, typography } from '@/theme/tokens';

export default function HomeScreen() {
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
        M0 工程导航已就绪；建房、加入和扫码将在 M2 接入权威服务。
      </Text>
    </PageShell>
  );
}

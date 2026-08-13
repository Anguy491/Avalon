import { Text, View } from 'react-native';

import { PageShell } from '@/components/page-shell';
import { color, spacing, typography } from '@/theme/tokens';

export default function CreateRoomScreen() {
  return (
    <PageShell>
      <View style={{ gap: spacing.sm }}>
        <Text
          selectable
          accessibilityRole="header"
          style={{
            color: color.text.primary,
            fontSize: typography.title,
            fontWeight: '800',
          }}
        >
          创建房间
        </Text>
        <Text
          selectable
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          M0 已建立页面和布局回路。人数、角色预设与昵称表单将在 M2
          实现，并由服务端最终校验。
        </Text>
      </View>
    </PageShell>
  );
}

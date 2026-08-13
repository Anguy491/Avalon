import { Text, View } from 'react-native';

import { PageShell } from '@/components/page-shell';
import { color, spacing, typography } from '@/theme/tokens';

export default function JoinRoomScreen() {
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
          输入房间号
        </Text>
        <Text
          selectable
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          六位单一输入语义、自动大写与粘贴将在 M2 接入；此页面当前用于验证 Expo
          Router 导航。
        </Text>
      </View>
    </PageShell>
  );
}

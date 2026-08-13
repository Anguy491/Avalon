import { Text, View } from 'react-native';

import { ActionLink } from '@/components/action-link';
import { PageShell } from '@/components/page-shell';
import { color, spacing, typography } from '@/theme/tokens';

export default function ScanRoomScreen() {
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
          扫描二维码
        </Text>
        <Text
          selectable
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          M0 不申请相机权限。M2 只会在本页可见且用户确认用途后请求权限。
        </Text>
      </View>
      <ActionLink
        href="/join"
        label="改用房间号"
        description="无需相机权限即可继续"
        primary
      />
    </PageShell>
  );
}

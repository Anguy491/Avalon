import { Text } from 'react-native';

import { ActionLink } from '@/components/action-link';
import { PageShell } from '@/components/page-shell';

export default function NotFoundScreen() {
  return (
    <PageShell>
      <Text selectable accessibilityRole="header">
        找不到这个页面
      </Text>
      <ActionLink
        href="/"
        label="返回首页"
        description="回到公开入口"
        primary
      />
    </PageShell>
  );
}

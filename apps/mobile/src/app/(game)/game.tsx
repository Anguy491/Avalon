import { Text } from 'react-native';

import { PageShell } from '@/components/page-shell';

export default function GamePlaceholder() {
  return (
    <PageShell>
      <Text selectable accessibilityRole="header">
        服务端权威对局桌面将在 M4 实现
      </Text>
    </PageShell>
  );
}

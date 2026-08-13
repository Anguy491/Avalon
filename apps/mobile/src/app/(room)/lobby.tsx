import { Text } from 'react-native';

import { PageShell } from '@/components/page-shell';

export default function LobbyPlaceholder() {
  return (
    <PageShell>
      <Text selectable accessibilityRole="header">
        大厅投影将在 M3 实现
      </Text>
    </PageShell>
  );
}

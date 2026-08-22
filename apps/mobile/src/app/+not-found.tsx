import { Text } from 'react-native';

import { ActionLink } from '@/components/action-link';
import { PageShell } from '@/components/page-shell';
import { useI18n } from '@/localization/localization-provider';

export default function NotFoundScreen() {
  const { t } = useI18n();
  return (
    <PageShell>
      <Text selectable accessibilityRole="header">
        {t('notFoundTitle')}
      </Text>
      <ActionLink
        href="/"
        label={t('commonReturnHome')}
        description={t('notFoundDescription')}
        primary
      />
    </PageShell>
  );
}

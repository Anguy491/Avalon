import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { ActionLink } from '@/components/action-link';
import { FormField } from '@/components/form-field';
import { PageShell } from '@/components/page-shell';
import { PrimaryButton } from '@/components/primary-button';
import { useI18n } from '@/localization/localization-provider';
import { usePublicDraft } from '@/session/public-draft-provider';
import { useSession } from '@/session/session-provider';
import { terminalSessionDisposition } from '@/session/terminal-session-state';
import { spacing, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

export default function HomeScreen() {
  const { color } = useAppTheme();
  const { t } = useI18n();
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
      <Stack.Screen options={{ title: t('commonAvalon') }} />
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
          {t('homeTitle')}
        </Text>
        <Text
          selectable
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          {t('homeSubtitle')}
        </Text>
      </View>

      <FormField
        label={t('homeNickname')}
        value={draft.nickname}
        onChangeText={draft.setNickname}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={48}
        placeholder={t('homeNicknamePlaceholder')}
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
            {t('homeRecovering')}
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
            {t('homeOfflineSummary', {
              roomCode: session.summary.roomCode,
            })}
          </Text>
          <PrimaryButton
            label={t('homeWaitRetry')}
            onPress={() => void session.recover()}
          />
          <PrimaryButton
            label={t('homeClearSession')}
            onPress={() => void session.forgetSession()}
          />
        </View>
      ) : null}

      <View style={{ gap: spacing.md }}>
        <ActionLink
          href="/create"
          label={t('navCreateRoom')}
          description={t('homeCreateDescription')}
          primary
        />
        <ActionLink
          href="/join"
          label={t('homeJoin')}
          description={t('homeJoinDescription')}
        />
        <ActionLink
          href="/scan"
          label={t('navScanQr')}
          description={t('homeScanDescription')}
        />
      </View>

      <Text
        selectable
        style={{ color: color.text.secondary, fontSize: typography.supporting }}
      >
        {t('homePrivacy')}
      </Text>
    </PageShell>
  );
}

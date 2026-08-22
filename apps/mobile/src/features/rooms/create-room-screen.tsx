import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { useReducer } from 'react';
import { Text, View } from 'react-native';

import { FormField } from '@/components/form-field';
import { PageShell } from '@/components/page-shell';
import { PrimaryButton } from '@/components/primary-button';
import { useI18n } from '@/localization/localization-provider';
import { nicknameErrorCode, normalizeNickname } from '@/rooms/nickname';
import { usePublicDraft } from '@/session/public-draft-provider';
import { useSession } from '@/session/session-provider';
import { spacing, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

import {
  INITIAL_CREATE_CONFIG_DRAFT,
  configInputFromDraft,
  isConfigDraftStructurallySubmittable,
  lobbyConfigReducer,
} from './lobby-state';
import { RoomConfigFields } from './room-config-fields';

interface CreateValues {
  readonly nickname: string;
}

export function CreateRoomScreen() {
  const { color } = useAppTheme();
  const { t } = useI18n();
  const session = useSession();
  const publicDraft = usePublicDraft();
  const [configDraft, dispatchConfig] = useReducer(
    lobbyConfigReducer,
    INITIAL_CREATE_CONFIG_DRAFT,
  );
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    defaultValues: { nickname: publicDraft.nickname },
  });
  const configReady = isConfigDraftStructurallySubmittable(configDraft);

  const submit = handleSubmit(async (values) => {
    if (!configReady) return;
    const nickname = normalizeNickname(values.nickname);
    publicDraft.setNickname(nickname);
    try {
      await session.createRoom(nickname, configInputFromDraft(configDraft));
      router.replace('/lobby');
    } catch {
      // The provider exposes only a localized, token-free error string.
    }
  });

  return (
    <PageShell>
      <View style={{ gap: spacing.xs }}>
        <Text
          selectable
          accessibilityRole="header"
          style={{
            color: color.text.primary,
            fontSize: typography.title,
            fontWeight: '800',
          }}
        >
          {t('createTitle')}
        </Text>
        <Text
          selectable
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          {t('createSubtitle')}
        </Text>
      </View>

      <RoomConfigFields
        draft={configDraft}
        busy={isSubmitting}
        dispatch={dispatchConfig}
      />

      <Controller
        control={control}
        name="nickname"
        rules={{
          validate: (value) => {
            const code = nicknameErrorCode(value);
            if (code === 'CONTROL_CHARACTER') {
              return t('nicknameControlCharacter');
            }
            if (code === 'INVALID_LENGTH') return t('nicknameInvalidLength');
            return true;
          },
        }}
        render={({ field: { onBlur, onChange, value } }) => (
          <FormField
            label={t('homeNickname')}
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={48}
            returnKeyType="done"
            error={errors.nickname?.message}
          />
        )}
      />

      {session.error === undefined ? null : (
        <Text
          selectable
          accessibilityLiveRegion="assertive"
          style={{ color: color.result.failure, fontSize: typography.body }}
        >
          {session.error}
        </Text>
      )}
      <PrimaryButton
        label={t('createTitle')}
        testID="create-room-submit"
        busy={isSubmitting}
        disabled={!configReady}
        onPress={() => void submit()}
        accessibilityHint={
          configReady ? t('createSubmitHint') : t('createInvalidConfigHint')
        }
      />
    </PageShell>
  );
}

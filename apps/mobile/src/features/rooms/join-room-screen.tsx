import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { Text, View } from 'react-native';

import { FormField } from '@/components/form-field';
import { PageShell } from '@/components/page-shell';
import { PrimaryButton } from '@/components/primary-button';
import { useI18n } from '@/localization/localization-provider';
import { nicknameErrorCode, normalizeNickname } from '@/rooms/nickname';
import { normalizeRoomCode, ROOM_CODE_PATTERN } from '@/rooms/room-code';
import { usePublicDraft } from '@/session/public-draft-provider';
import { useSession } from '@/session/session-provider';
import { spacing, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

interface JoinValues {
  readonly roomCode: string;
  readonly nickname: string;
}

export function JoinRoomScreen({
  initialRoomCode = '',
}: {
  initialRoomCode?: string;
}) {
  const { color } = useAppTheme();
  const { t } = useI18n();
  const session = useSession();
  const draft = usePublicDraft();
  const {
    control,
    getValues,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<JoinValues>({
    defaultValues: {
      roomCode: normalizeRoomCode(initialRoomCode),
      nickname: draft.nickname,
    },
  });

  const submit = handleSubmit(async (values) => {
    const nickname = normalizeNickname(values.nickname);
    const roomCode = normalizeRoomCode(values.roomCode);
    draft.setNickname(nickname);
    try {
      await session.joinRoom(nickname, roomCode);
      router.replace('/lobby');
    } catch {
      // A localized inline error is exposed by SessionProvider.
    }
  });

  const submitWithImmediateRoomCodeCheck = () => {
    if (!ROOM_CODE_PATTERN.test(normalizeRoomCode(getValues('roomCode')))) {
      setError('roomCode', {
        type: 'validate',
        message: t('joinRoomCodeError'),
      });
      return;
    }
    void submit();
  };

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
          {t('joinTitle')}
        </Text>
        <Text
          selectable
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          {t('joinSubtitle')}
        </Text>
      </View>

      <Controller
        control={control}
        name="roomCode"
        rules={{
          validate: (value) =>
            ROOM_CODE_PATTERN.test(normalizeRoomCode(value)) ||
            t('joinRoomCodeError'),
        }}
        render={({ field: { onBlur, onChange, value } }) => (
          <FormField
            label={t('joinRoomCode')}
            testID="join-room-code"
            value={value}
            onBlur={onBlur}
            onChangeText={(next) => {
              onChange(normalizeRoomCode(next));
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            returnKeyType="next"
            error={errors.roomCode?.message}
            style={{
              letterSpacing: 10,
              textAlign: 'center',
              fontSize: 24,
              fontWeight: '800',
            }}
          />
        )}
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
            testID="join-nickname"
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
        label={t('joinTitle')}
        testID="join-room-submit"
        busy={isSubmitting}
        onPress={submitWithImmediateRoomCodeCheck}
        accessibilityHint={t('joinSubmitHint')}
      />
    </PageShell>
  );
}

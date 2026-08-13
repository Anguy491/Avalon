import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, Text, View } from 'react-native';

import type { RoomConfigInput } from '@avalon/protocol';

import { FormField } from '@/components/form-field';
import { PageShell } from '@/components/page-shell';
import { PrimaryButton } from '@/components/primary-button';
import { nicknameError, normalizeNickname } from '@/rooms/nickname';
import { usePublicDraft } from '@/session/public-draft-provider';
import { useSession } from '@/session/session-provider';
import { spacing, touchTarget, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

interface CreateValues {
  readonly nickname: string;
  readonly playerCount: number;
  readonly presetId: 'CLASSIC' | 'COMMON_ROLES';
}

export function CreateRoomScreen() {
  const { color } = useAppTheme();
  const session = useSession();
  const draft = usePublicDraft();
  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    defaultValues: {
      nickname: draft.nickname,
      playerCount: 5,
      presetId: 'CLASSIC',
    },
  });
  const playerCount = watch('playerCount');
  const presetId = watch('presetId');

  const submit = handleSubmit(async (values) => {
    const nickname = normalizeNickname(values.nickname);
    draft.setNickname(nickname);
    const config: RoomConfigInput = {
      rulesVersion: 'CLASSIC_AVALON_V1',
      playerCount: values.playerCount,
      roleSelection: { type: 'PRESET', presetId: values.presetId },
      locale: 'zh-CN',
    };
    try {
      await session.createRoom(nickname, config);
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
          创建房间
        </Text>
        <Text
          selectable
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          选择目标人数与公开角色预设。创建后你会占据第一个座次。
        </Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text
          selectable
          style={{
            color: color.text.primary,
            fontSize: typography.body,
            fontWeight: '700',
          }}
        >
          目标人数
        </Text>
        <View
          accessibilityLabel={`目标人数 ${String(playerCount)} 人`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
          }}
        >
          <Pressable
            accessibilityLabel="减少人数"
            accessibilityRole="button"
            accessibilityState={{ disabled: playerCount <= 5 }}
            disabled={playerCount <= 5}
            onPress={() => {
              setValue('playerCount', playerCount - 1);
            }}
            style={{
              minWidth: touchTarget.minimum,
              minHeight: touchTarget.minimum,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 12,
              backgroundColor: color.surface.card,
            }}
          >
            <Text style={{ color: color.text.primary, fontSize: 24 }}>−</Text>
          </Pressable>
          <Text
            selectable
            style={{
              color: color.text.primary,
              minWidth: 80,
              textAlign: 'center',
              fontSize: 24,
              fontWeight: '800',
            }}
          >
            {playerCount} 人
          </Text>
          <Pressable
            accessibilityLabel="增加人数"
            accessibilityRole="button"
            accessibilityState={{ disabled: playerCount >= 10 }}
            disabled={playerCount >= 10}
            onPress={() => {
              setValue('playerCount', playerCount + 1);
            }}
            style={{
              minWidth: touchTarget.minimum,
              minHeight: touchTarget.minimum,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 12,
              backgroundColor: color.surface.card,
            }}
          >
            <Text style={{ color: color.text.primary, fontSize: 24 }}>＋</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text
          selectable
          style={{
            color: color.text.primary,
            fontSize: typography.body,
            fontWeight: '700',
          }}
        >
          角色预设
        </Text>
        {(
          [
            ['CLASSIC', '经典', '梅林、刺客与基础忠臣/爪牙'],
            ['COMMON_ROLES', '常用角色', '加入常用特殊角色，服务端按人数补足'],
          ] as const
        ).map(([value, label, description]) => {
          const selected = presetId === value;
          return (
            <Pressable
              key={value}
              accessibilityLabel={`${label}预设`}
              accessibilityHint={description}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => {
                setValue('presetId', value);
              }}
              style={{
                minHeight: touchTarget.minimum,
                gap: spacing.xs,
                padding: spacing.md,
                borderRadius: 14,
                borderWidth: 2,
                borderColor: selected
                  ? color.action.selected
                  : color.text.secondary,
                backgroundColor: color.surface.card,
              }}
            >
              <Text
                style={{
                  color: color.text.primary,
                  fontSize: typography.body,
                  fontWeight: '800',
                }}
              >
                {selected ? '已选择 · ' : ''}
                {label}
              </Text>
              <Text
                style={{
                  color: color.text.secondary,
                  fontSize: typography.supporting,
                }}
              >
                {description}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Controller
        control={control}
        name="nickname"
        rules={{ validate: (value) => nicknameError(value) ?? true }}
        render={({ field: { onBlur, onChange, value } }) => (
          <FormField
            label="你的昵称"
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
        label="创建房间"
        testID="create-room-submit"
        busy={isSubmitting}
        onPress={() => void submit()}
        accessibilityHint="提交人数、角色预设和昵称"
      />
    </PageShell>
  );
}

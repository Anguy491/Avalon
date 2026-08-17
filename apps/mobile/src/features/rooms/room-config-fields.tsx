import { Pressable, Text, View } from 'react-native';

import { spacing, touchTarget, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

import type {
  ConfigMode,
  LobbyConfigAction,
  LobbyConfigDraft,
  RoleId,
} from './lobby-state';

const ROLE_OPTIONS = [
  ['MERLIN', '梅林'],
  ['LOYAL_SERVANT', '忠臣'],
  ['PERCIVAL', '派西维尔'],
  ['ASSASSIN', '刺客'],
  ['MINION', '爪牙'],
  ['MORGANA', '莫甘娜'],
  ['MORDRED', '莫德雷德'],
  ['OBERON', '奥伯伦'],
] as const satisfies readonly (readonly [RoleId, string])[];

const MODES: readonly (readonly [ConfigMode, string, string])[] = [
  ['CLASSIC', '基础配置', '梅林、刺客与基础忠臣/爪牙'],
  ['RECOMMENDED', '推荐配置', '按人数加入派西维尔与推荐特殊角色'],
  ['CUSTOM', '自定义', '逐个编辑公开角色数量，由服务端校验合法性'],
];

function StepButton({
  label,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const { color } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: touchTarget.minimum,
        minHeight: touchTarget.minimum,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.sm,
        borderRadius: 12,
        borderCurve: 'continuous',
        backgroundColor: color.surface.card,
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      <Text
        selectable
        style={{ color: color.text.primary, fontSize: typography.body }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function RoomConfigFields({
  draft,
  busy,
  dispatch,
}: {
  readonly draft: LobbyConfigDraft;
  readonly busy: boolean;
  readonly dispatch: React.Dispatch<LobbyConfigAction>;
}) {
  const { color } = useAppTheme();
  return (
    <>
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
          accessibilityLabel={`目标人数 ${String(draft.playerCount)} 人`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
          }}
        >
          <StepButton
            label="减少人数"
            disabled={busy || draft.playerCount <= 5}
            onPress={() => {
              dispatch({
                type: 'set-player-count',
                playerCount: draft.playerCount - 1,
              });
            }}
          />
          <Text
            selectable
            style={{
              minWidth: 80,
              textAlign: 'center',
              color: color.text.primary,
              fontSize: 24,
              fontWeight: '800',
              fontVariant: ['tabular-nums'],
            }}
          >
            {draft.playerCount} 人
          </Text>
          <StepButton
            label="增加人数"
            disabled={busy || draft.playerCount >= 10}
            onPress={() => {
              dispatch({
                type: 'set-player-count',
                playerCount: draft.playerCount + 1,
              });
            }}
          />
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
          游戏配置
        </Text>
        {MODES.map(([mode, label, description]) => {
          const selected = draft.mode === mode;
          return (
            <Pressable
              key={mode}
              accessibilityLabel={selected ? `已选择 · ${label}` : label}
              accessibilityHint={description}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: busy }}
              disabled={busy}
              onPress={() => {
                dispatch({ type: 'set-mode', mode });
              }}
              style={{
                minHeight: touchTarget.minimum,
                gap: spacing.xs,
                padding: spacing.md,
                borderRadius: 14,
                borderCurve: 'continuous',
                borderWidth: 2,
                borderColor: selected
                  ? color.action.selected
                  : color.text.secondary,
                backgroundColor: color.surface.card,
              }}
            >
              <Text
                selectable
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
                selectable
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

      {draft.mode !== 'CUSTOM' ? null : (
        <View style={{ gap: spacing.sm }}>
          <Text
            selectable
            accessibilityLiveRegion="polite"
            style={{ color: color.text.secondary, fontSize: typography.body }}
          >
            已选 {draft.customRoleIds.length} 个角色；目标人数为{' '}
            {draft.playerCount} 人。服务器会执行完整规则校验。
          </Text>
          {ROLE_OPTIONS.map(([roleId, label]) => {
            const count = draft.customRoleIds.filter(
              (candidate) => candidate === roleId,
            ).length;
            return (
              <View
                key={roleId}
                accessibilityLabel={`${label}，${String(count)} 个`}
                style={{
                  minHeight: touchTarget.minimum,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  padding: spacing.md,
                  borderRadius: 14,
                  borderCurve: 'continuous',
                  backgroundColor: color.surface.card,
                }}
              >
                <Text
                  selectable
                  style={{
                    flex: 1,
                    color: color.text.primary,
                    fontSize: typography.body,
                    fontWeight: '700',
                  }}
                >
                  {label}
                </Text>
                <StepButton
                  label={`减少${label}`}
                  disabled={busy || count === 0}
                  onPress={() => {
                    dispatch({ type: 'adjust-role-count', roleId, delta: -1 });
                  }}
                />
                <Text
                  selectable
                  style={{
                    minWidth: 24,
                    textAlign: 'center',
                    color: color.text.primary,
                    fontSize: typography.body,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {count}
                </Text>
                <StepButton
                  label={`增加${label}`}
                  disabled={
                    busy || draft.customRoleIds.length >= draft.playerCount
                  }
                  onPress={() => {
                    dispatch({ type: 'adjust-role-count', roleId, delta: 1 });
                  }}
                />
              </View>
            );
          })}
        </View>
      )}
    </>
  );
}

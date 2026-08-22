import { Pressable, Text, View } from 'react-native';

import { mappedMessageKey, ROLE_NAME_KEYS } from '@/localization/game-messages';
import { useI18n } from '@/localization/localization-provider';
import type { MessageKey } from '@/localization/messages';
import { spacing, touchTarget, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

import type {
  ConfigMode,
  LobbyConfigAction,
  LobbyConfigDraft,
  RoleId,
} from './lobby-state';

const ROLE_OPTIONS = [
  'MERLIN',
  'LOYAL_SERVANT',
  'PERCIVAL',
  'ASSASSIN',
  'MINION',
  'MORGANA',
  'MORDRED',
  'OBERON',
] as const satisfies readonly RoleId[];

const MODES: readonly (readonly [ConfigMode, MessageKey, MessageKey])[] = [
  ['CLASSIC', 'configModeClassic', 'configModeClassicDescription'],
  ['RECOMMENDED', 'configModeRecommended', 'configModeRecommendedDescription'],
  ['CUSTOM', 'configModeCustom', 'configModeCustomDescription'],
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
  const { t } = useI18n();
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
          {t('configTargetPlayers')}
        </Text>
        <View
          accessibilityLabel={t('configTargetPlayersAccessibility', {
            count: draft.playerCount,
          })}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
          }}
        >
          <StepButton
            label={t('configDecreasePlayers')}
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
            {t('configPlayerCount', { count: draft.playerCount })}
          </Text>
          <StepButton
            label={t('configIncreasePlayers')}
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
          {t('configGameSetup')}
        </Text>
        {MODES.map(([mode, labelKey, descriptionKey]) => {
          const selected = draft.mode === mode;
          const label = t(labelKey);
          const description = t(descriptionKey);
          return (
            <Pressable
              key={mode}
              accessibilityLabel={
                selected ? t('configSelectedLabel', { label }) : label
              }
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
                {selected ? t('configSelectedLabel', { label }) : label}
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
            {t('configCustomSummary', {
              selected: draft.customRoleIds.length,
              count: draft.playerCount,
            })}
          </Text>
          {ROLE_OPTIONS.map((roleId) => {
            const count = draft.customRoleIds.filter(
              (candidate) => candidate === roleId,
            ).length;
            const label = t(
              mappedMessageKey(ROLE_NAME_KEYS, roleId, 'commonUnknownRole'),
            );
            return (
              <View
                key={roleId}
                accessibilityLabel={t('configRoleCountAccessibility', {
                  role: label,
                  count,
                })}
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
                  label={t('configDecreaseRole', { role: label })}
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
                  label={t('configIncreaseRole', { role: label })}
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

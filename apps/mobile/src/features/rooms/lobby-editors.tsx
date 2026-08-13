import { useEffect, useReducer } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import type { RoomConfigInput, RoomView } from '@avalon/protocol/mobile';

import { PageShell } from '@/components/page-shell';
import { PrimaryButton } from '@/components/primary-button';
import { spacing, touchTarget, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

import {
  configInputFromDraft,
  initialLobbyConfigDraft,
  isConfigDraftStructurallySubmittable,
  lobbyConfigReducer,
  seatOrderReducer,
  type ConfigMode,
  type RoleId,
} from './lobby-state';

type Player = RoomView['public']['players'][number];

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

function SmallButton({
  label,
  onPress,
  disabled = false,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
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

export function LobbySeatEditor({
  visible,
  players,
  busy,
  onClose,
  onSave,
}: {
  readonly visible: boolean;
  readonly players: readonly Player[];
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSave: (playerIds: readonly string[]) => Promise<void>;
}) {
  const { color } = useAppTheme();
  const projectedOrder = players.map((player) => player.playerId);
  const [state, dispatch] = useReducer(seatOrderReducer, {
    playerIds: projectedOrder,
  });
  const orderKey = projectedOrder.join(':');

  useEffect(() => {
    if (visible) dispatch({ type: 'reset', playerIds: projectedOrder });
  }, [orderKey, visible]);

  const playerById = new Map(
    players.map((player) => [player.playerId, player]),
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
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
            调整座次
          </Text>
          <Text
            selectable
            style={{ color: color.text.secondary, fontSize: typography.body }}
          >
            使用上移和下移调整顺序，保存时一次提交完整座次。成功后全员需重新准备。
          </Text>
        </View>

        <View style={{ gap: spacing.sm }}>
          {state.playerIds.map((playerId, index) => {
            const player = playerById.get(playerId);
            if (player === undefined) return null;
            return (
              <View
                key={playerId}
                accessibilityLabel={`座次 ${String(index + 1)}，${player.nickname}${player.isHost ? '，房主' : ''}`}
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
                    width: 28,
                    color: color.action.primary,
                    fontSize: typography.body,
                    fontWeight: '900',
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {index + 1}
                </Text>
                <Text
                  selectable
                  style={{
                    flex: 1,
                    color: color.text.primary,
                    fontSize: typography.body,
                    fontWeight: '700',
                  }}
                >
                  {player.nickname} {player.isHost ? '· 房主' : ''}
                </Text>
                <SmallButton
                  label={`上移 ${player.nickname}`}
                  disabled={busy || index === 0}
                  onPress={() => {
                    dispatch({ type: 'move', playerId, delta: -1 });
                  }}
                />
                <SmallButton
                  label={`下移 ${player.nickname}`}
                  disabled={busy || index === state.playerIds.length - 1}
                  onPress={() => {
                    dispatch({ type: 'move', playerId, delta: 1 });
                  }}
                />
              </View>
            );
          })}
        </View>

        <PrimaryButton
          label="保存完整座次"
          busy={busy}
          onPress={() => {
            void onSave(state.playerIds);
          }}
        />
        <SmallButton label="取消调整" disabled={busy} onPress={onClose} />
      </PageShell>
    </Modal>
  );
}

export function LobbyConfigEditor({
  visible,
  config,
  busy,
  onClose,
  onSave,
}: {
  readonly visible: boolean;
  readonly config: RoomView['public']['config'];
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSave: (config: RoomConfigInput) => Promise<void>;
}) {
  const { color } = useAppTheme();
  const [draft, dispatch] = useReducer(
    lobbyConfigReducer,
    config,
    initialLobbyConfigDraft,
  );
  const configKey = `${String(config.playerCount)}:${config.roleIds.join(':')}`;

  useEffect(() => {
    if (visible) {
      dispatch({ type: 'reset', draft: initialLobbyConfigDraft(config) });
    }
  }, [configKey, visible]);

  const modes: readonly (readonly [ConfigMode, string, string])[] = [
    ['CLASSIC', '经典', '由服务端按目标人数展开经典角色'],
    ['COMMON_ROLES', '常用角色', '由服务端按目标人数展开常用特殊角色'],
    ['CUSTOM', '自定义', '编辑公开角色数量，合法性由服务端统一裁决'],
  ];
  const canSave = isConfigDraftStructurallySubmittable(draft);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
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
            房间配置
          </Text>
          <Text
            selectable
            style={{ color: color.text.secondary, fontSize: typography.body }}
          >
            保存成功会让所有玩家恢复为未准备。角色组合的最终合法性始终由服务器检查。
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
            accessibilityLabel={`目标人数 ${String(draft.playerCount)} 人`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
            }}
          >
            <SmallButton
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
            <SmallButton
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
            角色方案
          </Text>
          {modes.map(([mode, label, description]) => {
            const selected = draft.mode === mode;
            return (
              <Pressable
                key={mode}
                accessibilityLabel={`${label}角色方案`}
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
              已选 {draft.customRoleIds.length} 个角色；结构要求为 5–10
              个。服务器会返回完整配置错误。
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
                  <SmallButton
                    label={`减少${label}`}
                    disabled={busy || count === 0}
                    onPress={() => {
                      dispatch({
                        type: 'adjust-role-count',
                        roleId,
                        delta: -1,
                      });
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
                  <SmallButton
                    label={`增加${label}`}
                    disabled={busy || draft.customRoleIds.length >= 10}
                    onPress={() => {
                      dispatch({
                        type: 'adjust-role-count',
                        roleId,
                        delta: 1,
                      });
                    }}
                  />
                </View>
              );
            })}
          </View>
        )}

        <PrimaryButton
          label="保存配置"
          disabled={!canSave}
          busy={busy}
          accessibilityHint={
            canSave
              ? '提交完整配置，由服务器校验角色组合'
              : '自定义角色数量必须为五到十个'
          }
          onPress={() => {
            void onSave(configInputFromDraft(draft));
          }}
        />
        <SmallButton label="取消编辑" disabled={busy} onPress={onClose} />
      </PageShell>
    </Modal>
  );
}

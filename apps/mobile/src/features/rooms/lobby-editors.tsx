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
} from './lobby-state';
import { RoomConfigFields } from './room-config-fields';

type Player = RoomView['public']['players'][number];

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

        <RoomConfigFields draft={draft} busy={busy} dispatch={dispatch} />

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

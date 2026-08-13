import type {
  CommandType,
  RoomConfigInput,
  RoomView,
} from '@avalon/protocol/mobile';

type Player = RoomView['public']['players'][number];
export type RoleId = RoomView['public']['config']['roleIds'][number];

export interface LobbyUiState {
  readonly players: readonly Player[];
  readonly self: Player | undefined;
  readonly isHost: boolean;
  readonly allowedActions: ReadonlySet<CommandType>;
  readonly eligibleKickPlayers: readonly Player[];
}

export function deriveLobbyUiState(roomView: RoomView): LobbyUiState {
  const players = [...roomView.public.players].sort(
    (left, right) => left.seat - right.seat,
  );
  const self = players.find(
    (player) => player.playerId === roomView.private.playerId,
  );
  const allowedActions = new Set(
    roomView.private.availableActions.map((action) => action.commandType),
  );
  const kickAction = roomView.private.availableActions.find(
    (action) => action.commandType === 'KickLobbyPlayer',
  );
  const eligibleIds = new Set(kickAction?.eligibleTargetPlayerIds ?? []);
  return {
    players,
    self,
    isHost: self?.isHost === true,
    allowedActions,
    eligibleKickPlayers: players.filter((player) =>
      eligibleIds.has(player.playerId),
    ),
  };
}

export interface SeatOrderState {
  readonly playerIds: readonly string[];
}

export type SeatOrderAction =
  | { readonly type: 'reset'; readonly playerIds: readonly string[] }
  | {
      readonly type: 'move';
      readonly playerId: string;
      readonly delta: -1 | 1;
    };

export function seatOrderReducer(
  state: SeatOrderState,
  action: SeatOrderAction,
): SeatOrderState {
  if (action.type === 'reset') return { playerIds: [...action.playerIds] };
  const currentIndex = state.playerIds.indexOf(action.playerId);
  const nextIndex = currentIndex + action.delta;
  if (
    currentIndex < 0 ||
    nextIndex < 0 ||
    nextIndex >= state.playerIds.length
  ) {
    return state;
  }
  const playerIds = [...state.playerIds];
  [playerIds[currentIndex], playerIds[nextIndex]] = [
    playerIds[nextIndex] as string,
    playerIds[currentIndex] as string,
  ];
  return { playerIds };
}

export type ConfigMode = 'CLASSIC' | 'COMMON_ROLES' | 'CUSTOM';

export interface LobbyConfigDraft {
  readonly playerCount: number;
  readonly mode: ConfigMode;
  readonly customRoleIds: readonly RoleId[];
}

export type LobbyConfigAction =
  | { readonly type: 'reset'; readonly draft: LobbyConfigDraft }
  | { readonly type: 'set-player-count'; readonly playerCount: number }
  | { readonly type: 'set-mode'; readonly mode: ConfigMode }
  | {
      readonly type: 'adjust-role-count';
      readonly roleId: RoleId;
      readonly delta: -1 | 1;
    };

export function initialLobbyConfigDraft(
  config: RoomView['public']['config'],
): LobbyConfigDraft {
  return {
    playerCount: config.playerCount,
    mode: 'CUSTOM',
    customRoleIds: [...config.roleIds],
  };
}

export function lobbyConfigReducer(
  state: LobbyConfigDraft,
  action: LobbyConfigAction,
): LobbyConfigDraft {
  switch (action.type) {
    case 'reset':
      return action.draft;
    case 'set-player-count':
      return { ...state, playerCount: action.playerCount };
    case 'set-mode':
      return { ...state, mode: action.mode };
    case 'adjust-role-count': {
      if (action.delta === 1) {
        if (state.customRoleIds.length >= 10) return state;
        return {
          ...state,
          customRoleIds: [...state.customRoleIds, action.roleId],
        };
      }
      const index = state.customRoleIds.lastIndexOf(action.roleId);
      if (index < 0) return state;
      return {
        ...state,
        customRoleIds: state.customRoleIds.filter(
          (_roleId, roleIndex) => roleIndex !== index,
        ),
      };
    }
  }
}

export function isConfigDraftStructurallySubmittable(
  draft: LobbyConfigDraft,
): boolean {
  return (
    draft.playerCount >= 5 &&
    draft.playerCount <= 10 &&
    (draft.mode !== 'CUSTOM' ||
      (draft.customRoleIds.length >= 5 && draft.customRoleIds.length <= 10))
  );
}

export function configInputFromDraft(draft: LobbyConfigDraft): RoomConfigInput {
  return {
    rulesVersion: 'CLASSIC_AVALON_V1',
    playerCount: draft.playerCount,
    roleSelection:
      draft.mode === 'CUSTOM'
        ? { type: 'CUSTOM', roleIds: [...draft.customRoleIds] }
        : { type: 'PRESET', presetId: draft.mode },
    locale: 'zh-CN',
  };
}

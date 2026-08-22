import type { RoomView } from '@avalon/protocol/mobile';

type GamePhase = RoomView['public']['phase'];
type RoleRevealRedirect = '/lobby' | '/game' | '/assassination' | '/result';

export function roleRevealRedirectForPhase(
  phase: GamePhase,
): RoleRevealRedirect | undefined {
  switch (phase) {
    case 'ROLE_REVEAL':
    case 'PAUSED':
      return undefined;
    case 'LOBBY':
      return '/lobby';
    case 'ASSASSINATION':
      return '/assassination';
    case 'GAME_OVER':
      return '/result';
    default:
      return '/game';
  }
}

export type RoleId = Exclude<RoomView['private']['selfRole'], null | undefined>;
type KnowledgeLabel =
  RoomView['private']['knownPlayers'][number]['knowledgeLabel'];

export interface KnowledgeItem {
  readonly playerId: string;
  readonly playerName: string;
  readonly knowledgeLabel: KnowledgeLabel;
}

export interface RoleRevealUiState {
  readonly roleId: RoleId | undefined;
  readonly alignment: RoomView['private']['selfAlignment'];
  readonly knowledgeItems: readonly KnowledgeItem[];
  readonly canContinue: boolean;
  readonly canAcknowledge: boolean;
  readonly hasSubmitted: boolean;
  readonly submittedCount: number;
  readonly requiredCount: number;
}

export function deriveRoleRevealUiState(roomView: RoomView): RoleRevealUiState {
  const roleId = roomView.private.selfRole ?? undefined;
  const names = new Map(
    roomView.public.players.map((player) => [player.playerId, player.nickname]),
  );
  const available = new Set(
    roomView.private.availableActions.map((action) => action.commandType),
  );
  const progress = roomView.public.submissionProgress;
  return {
    roleId,
    alignment: roomView.private.selfAlignment,
    knowledgeItems: roomView.private.knownPlayers.map((known) => ({
      playerId: known.playerId,
      playerName: names.get(known.playerId) ?? '',
      knowledgeLabel: known.knowledgeLabel,
    })),
    canContinue: available.has('ContinuePhase'),
    canAcknowledge: available.has('AckRole'),
    hasSubmitted: roomView.private.hasSubmitted,
    submittedCount: progress?.submittedCount ?? 0,
    requiredCount: progress?.requiredCount ?? roomView.public.players.length,
  };
}

export type RevealMode = 'MASKED' | 'HOLD' | 'TOGGLE';

export interface PrivacyGateState {
  readonly mode: RevealMode;
  readonly hasViewed: boolean;
}

export type PrivacyGateAction =
  | { readonly type: 'hold-reveal' }
  | { readonly type: 'hold-release' }
  | { readonly type: 'toggle-reveal' }
  | { readonly type: 'conceal' }
  | { readonly type: 'acknowledged' };

export const INITIAL_PRIVACY_GATE: PrivacyGateState = {
  mode: 'MASKED',
  hasViewed: false,
};

export function privacyGateReducer(
  state: PrivacyGateState,
  action: PrivacyGateAction,
): PrivacyGateState {
  switch (action.type) {
    case 'hold-reveal':
      return { mode: 'HOLD', hasViewed: true };
    case 'hold-release':
      return state.mode === 'HOLD' ? { ...state, mode: 'MASKED' } : state;
    case 'toggle-reveal':
      return {
        mode: state.mode === 'TOGGLE' ? 'MASKED' : 'TOGGLE',
        hasViewed: true,
      };
    case 'conceal':
      return { ...state, mode: 'MASKED' };
    case 'acknowledged':
      return INITIAL_PRIVACY_GATE;
  }
}

export function isRoleRevealed(state: PrivacyGateState): boolean {
  return state.mode !== 'MASKED';
}

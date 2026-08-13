import type { RoomView } from '@avalon/protocol/mobile';

export type RoleId = Exclude<RoomView['private']['selfRole'], null | undefined>;
type KnowledgeLabel =
  RoomView['private']['knownPlayers'][number]['knowledgeLabel'];

export const ROLE_PRESENTATION: Readonly<
  Record<RoleId, { readonly label: string; readonly ability: string }>
> = {
  MERLIN: {
    label: '梅林',
    ability: '你知道除莫德雷德外的邪恶玩家。保护自己的身份，避免被刺客识破。',
  },
  LOYAL_SERVANT: {
    label: '忠臣',
    ability: '你没有额外的开局信息。通过讨论与投票协助善良阵营完成任务。',
  },
  PERCIVAL: {
    label: '派西维尔',
    ability: '你会看到不可区分的梅林候选人。莫甘娜在场时会混入候选名单。',
  },
  ASSASSIN: {
    label: '刺客',
    ability: '你属于邪恶阵营。善良阵营完成三次任务后，你将选择刺杀目标。',
  },
  MINION: {
    label: '爪牙',
    ability: '你属于邪恶阵营，并会看到规则允许你知道的邪恶同伴。',
  },
  MORGANA: {
    label: '莫甘娜',
    ability: '你属于邪恶阵营，并会在派西维尔眼中伪装成梅林候选人。',
  },
  MORDRED: {
    label: '莫德雷德',
    ability: '你属于邪恶阵营；梅林无法在开局知识中看到你。',
  },
  OBERON: {
    label: '奥伯伦',
    ability: '你属于邪恶阵营，但不会获得其他邪恶玩家的同伴信息。',
  },
};

const KNOWLEDGE_LABELS: Readonly<Record<KnowledgeLabel, string>> = {
  EVIL_PLAYER: '邪恶玩家',
  MERLIN_CANDIDATE: '梅林候选人',
  KNOWN_EVIL_ALLY: '已知邪恶同伴',
};

export interface KnowledgeItem {
  readonly playerId: string;
  readonly playerName: string;
  readonly label: string;
}

export interface RoleRevealUiState {
  readonly roleId: RoleId | undefined;
  readonly roleLabel: string | undefined;
  readonly ability: string | undefined;
  readonly alignmentLabel: '善良阵营' | '邪恶阵营' | undefined;
  readonly knowledgeItems: readonly KnowledgeItem[];
  readonly canContinue: boolean;
  readonly canAcknowledge: boolean;
  readonly hasSubmitted: boolean;
  readonly submittedCount: number;
  readonly requiredCount: number;
}

export function deriveRoleRevealUiState(roomView: RoomView): RoleRevealUiState {
  const roleId = roomView.private.selfRole ?? undefined;
  const presentation =
    roleId === undefined ? undefined : ROLE_PRESENTATION[roleId];
  const names = new Map(
    roomView.public.players.map((player) => [player.playerId, player.nickname]),
  );
  const available = new Set(
    roomView.private.availableActions.map((action) => action.commandType),
  );
  const progress = roomView.public.submissionProgress;
  return {
    roleId,
    roleLabel: presentation?.label,
    ability: presentation?.ability,
    alignmentLabel:
      roomView.private.selfAlignment === 'GOOD'
        ? '善良阵营'
        : roomView.private.selfAlignment === 'EVIL'
          ? '邪恶阵营'
          : undefined,
    knowledgeItems: roomView.private.knownPlayers.map((known) => ({
      playerId: known.playerId,
      playerName: names.get(known.playerId) ?? '同桌玩家',
      label: KNOWLEDGE_LABELS[known.knowledgeLabel],
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

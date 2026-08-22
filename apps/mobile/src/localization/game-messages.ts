import type { RoomView } from '@avalon/protocol/mobile';

import type { GameContinueAction } from '@/features/game/game-state';
import type { RoleId } from '@/features/roles/role-reveal-state';

import type { MessageKey } from './messages';

export function mappedMessageKey(
  mapping: Readonly<Partial<Record<string, MessageKey>>>,
  value: string,
  fallback: MessageKey,
): MessageKey {
  return mapping[value] ?? fallback;
}

type KnowledgeLabel =
  RoomView['private']['knownPlayers'][number]['knowledgeLabel'];
type Outcome = NonNullable<RoomView['public']['gameOutcome']>;

export const ROLE_NAME_KEYS: Readonly<Record<RoleId, MessageKey>> = {
  MERLIN: 'roleMerlin',
  LOYAL_SERVANT: 'roleLoyalServant',
  PERCIVAL: 'rolePercival',
  ASSASSIN: 'roleAssassin',
  MINION: 'roleMinion',
  MORGANA: 'roleMorgana',
  MORDRED: 'roleMordred',
  OBERON: 'roleOberon',
};

export const ROLE_ABILITY_KEYS: Readonly<Record<RoleId, MessageKey>> = {
  MERLIN: 'abilityMerlin',
  LOYAL_SERVANT: 'abilityLoyalServant',
  PERCIVAL: 'abilityPercival',
  ASSASSIN: 'abilityAssassin',
  MINION: 'abilityMinion',
  MORGANA: 'abilityMorgana',
  MORDRED: 'abilityMordred',
  OBERON: 'abilityOberon',
};

export const KNOWLEDGE_LABEL_KEYS: Readonly<
  Record<KnowledgeLabel, MessageKey>
> = {
  EVIL_PLAYER: 'knowledgeEvilPlayer',
  MERLIN_CANDIDATE: 'knowledgeMerlinCandidate',
  KNOWN_EVIL_ALLY: 'knowledgeKnownEvilAlly',
};

export const ALIGNMENT_KEYS: Readonly<Record<'GOOD' | 'EVIL', MessageKey>> = {
  GOOD: 'alignmentGood',
  EVIL: 'alignmentEvil',
};

export const PHASE_KEYS: Readonly<
  Record<RoomView['public']['phase'], MessageKey>
> = {
  LOBBY: 'phaseLobby',
  ROLE_REVEAL: 'phaseRoleReveal',
  TEAM_PROPOSAL: 'phaseTeamProposal',
  TEAM_VOTE: 'phaseTeamVote',
  QUEST_SUBMISSION: 'phaseQuestSubmission',
  QUEST_RESOLUTION: 'phaseQuestResolution',
  ASSASSINATION: 'phaseAssassination',
  GAME_OVER: 'phaseGameOver',
  PAUSED: 'phasePaused',
};

export const CONTINUE_ACTION_KEYS: Readonly<
  Record<GameContinueAction, MessageKey>
> = {
  OPEN_TEAM_PROPOSAL: 'continueOpenTeamProposal',
  START_TEAM_VOTE: 'continueStartTeamVote',
  VIEW_RESULT: 'continueViewResult',
  CONTINUE_TO_QUEST: 'continueQuestAction',
  START_NEXT_PROPOSAL: 'continueNextProposal',
  OPEN_QUEST: 'continueOpenQuest',
  CONTINUE_TO_ASSASSINATION: 'continueAssassination',
  START_NEXT_QUEST: 'continueNextQuest',
  OPEN_ASSASSINATION: 'continueOpenAssassination',
  CONTINUE: 'commonContinue',
};

export const OUTCOME_REASON_KEYS: Readonly<
  Record<Outcome['reason'], MessageKey>
> = {
  THREE_QUEST_FAILURES: 'outcomeThreeFailures',
  FIVE_REJECTED_TEAMS: 'outcomeFiveRejected',
  MERLIN_ASSASSINATED: 'outcomeMerlinAssassinated',
  MERLIN_SURVIVED: 'outcomeMerlinSurvived',
  ABORTED: 'outcomeAbortedReason',
};

export const WINNER_KEYS: Readonly<Record<Outcome['winner'], MessageKey>> = {
  GOOD: 'outcomeGoodWins',
  EVIL: 'outcomeEvilWins',
  NONE: 'outcomeAborted',
};

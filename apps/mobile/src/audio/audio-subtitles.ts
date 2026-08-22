import type { MessageKey } from '@/localization/messages';

import type { VoicePackKey } from './voice-pack.generated';

export const AUDIO_SUBTITLE_KEYS: Readonly<Record<VoicePackKey, MessageKey>> = {
  'game.role.reveal': 'audioCueRoleReveal',
  'game.team.proposal': 'audioCueTeamProposal',
  'game.team.vote': 'audioCueTeamVote',
  'game.team.approved': 'audioCueTeamApproved',
  'game.team.rejected': 'audioCueTeamRejected',
  'game.quest.submission': 'audioCueQuestSubmission',
  'game.quest.success': 'audioCueQuestSuccess',
  'game.quest.failure': 'audioCueQuestFailure',
  'game.assassination': 'audioCueAssassination',
  'game.good.wins': 'audioCueGoodWins',
  'game.evil.wins': 'audioCueEvilWins',
  'game.aborted': 'audioCueAborted',
};

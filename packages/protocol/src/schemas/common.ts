import { Type, type Static, type TSchema } from '@sinclair/typebox';

import {
  JSON_SCHEMA_DRAFT,
  SCHEMA_BASE_URL,
  type SchemaDocument,
} from './metadata.js';

// The generic preserves each tuple member as a literal in the inferred Static type.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const literalUnion = <const T extends readonly string[]>(values: T) =>
  Type.Union(values.map((value) => Type.Literal(value)));

export const UuidSchema = Type.String({ format: 'uuid' });
export const RoomCodeSchema = Type.String({
  pattern: '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$',
});
export const NicknameSchema = Type.String({ minLength: 1, maxLength: 16 });
export const SessionTokenSchema = Type.String({
  minLength: 22,
  pattern: '^[A-Za-z0-9_-]+$',
});
export const RulesVersionSchema = Type.Literal('CLASSIC_AVALON_V1');
export const RoleIdSchema = literalUnion([
  'MERLIN',
  'LOYAL_SERVANT',
  'PERCIVAL',
  'ASSASSIN',
  'MINION',
  'MORGANA',
  'MORDRED',
  'OBERON',
] as const);
export const AlignmentSchema = literalUnion(['GOOD', 'EVIL'] as const);
export const GamePhaseSchema = literalUnion([
  'LOBBY',
  'ROLE_REVEAL',
  'TEAM_PROPOSAL',
  'TEAM_VOTE',
  'QUEST_SUBMISSION',
  'QUEST_RESOLUTION',
  'ASSASSINATION',
  'GAME_OVER',
  'PAUSED',
] as const);
export const PhaseStageSchema = literalUnion([
  'HOST_HELD',
  'COLLECTING',
  'RESOLVED',
] as const);
export const TeamVoteSchema = literalUnion(['APPROVE', 'REJECT'] as const);
export const QuestChoiceSchema = literalUnion(['SUCCESS', 'FAIL'] as const);
export const QuestResultSchema = literalUnion(['SUCCESS', 'FAILURE'] as const);
export const WinnerSchema = literalUnion(['GOOD', 'EVIL', 'NONE'] as const);
export const GameOutcomeReasonSchema = literalUnion([
  'THREE_QUEST_FAILURES',
  'FIVE_REJECTED_TEAMS',
  'MERLIN_ASSASSINATED',
  'MERLIN_SURVIVED',
  'ABORTED',
] as const);
export const CommandTypeSchema = literalUnion([
  'ConfigureRoom',
  'ReorderSeats',
  'SetReady',
  'StartGame',
  'ContinuePhase',
  'AckRole',
  'SubmitTeam',
  'SubmitTeamVote',
  'SubmitQuestChoice',
  'SelectMerlinTarget',
  'PauseGame',
  'ResumeGame',
  'ReplayAudioCue',
  'LeaveLobby',
  'KickLobbyPlayer',
  'CloseRoom',
] as const);
export const ErrorCodeSchema = literalUnion([
  'INVALID_ROOM_CODE',
  'ROOM_FULL',
  'ROOM_NOT_JOINABLE',
  'ROOM_EXPIRED',
  'SESSION_INVALID',
  'NICKNAME_CONFLICT',
  'INVALID_NICKNAME',
  'NOT_HOST',
  'NOT_LEADER',
  'NOT_ASSASSIN',
  'INVALID_PHASE',
  'INVALID_PHASE_STAGE',
  'PHASE_HELD',
  'STALE_VERSION',
  'DUPLICATE_COMMAND_CONFLICT',
  'INVALID_CONFIG',
  'INVALID_SEAT_ORDER',
  'INVALID_TEAM_SIZE',
  'INVALID_TEAM_MEMBER',
  'INVALID_VOTE',
  'INVALID_TARGET',
  'PLAYER_NOT_ON_TEAM',
  'GOOD_CANNOT_FAIL',
  'ALREADY_SUBMITTED',
  'HOST_CANNOT_LEAVE',
  'PLAYERS_NOT_READY',
  'PLAYERS_OFFLINE',
  'AUDIO_CUE_NOT_FOUND',
  'INVALID_PAUSE_REASON',
  'UPGRADE_REQUIRED',
  'RATE_LIMITED',
  'VALIDATION_ERROR',
  'PAYLOAD_TOO_LARGE',
  'UNAUTHORIZED',
  'INTERNAL_ERROR',
] as const);

const definitions = {
  Uuid: UuidSchema,
  RoomCode: RoomCodeSchema,
  Nickname: NicknameSchema,
  SessionToken: SessionTokenSchema,
  RulesVersion: RulesVersionSchema,
  RoleId: RoleIdSchema,
  Alignment: AlignmentSchema,
  GamePhase: GamePhaseSchema,
  PhaseStage: PhaseStageSchema,
  TeamVote: TeamVoteSchema,
  QuestChoice: QuestChoiceSchema,
  QuestResult: QuestResultSchema,
  Winner: WinnerSchema,
  GameOutcomeReason: GameOutcomeReasonSchema,
  CommandType: CommandTypeSchema,
  ErrorCode: ErrorCodeSchema,
} satisfies Record<string, TSchema>;

export const CommonSchemaDocument = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: `${SCHEMA_BASE_URL}common.schema.json`,
  title: 'Avalon protocol v1 common types',
  $defs: definitions,
} as const satisfies SchemaDocument;

export type RoleId = Static<typeof RoleIdSchema>;
export type Alignment = Static<typeof AlignmentSchema>;
export type GamePhase = Static<typeof GamePhaseSchema>;
export type PhaseStage = Static<typeof PhaseStageSchema>;
export type TeamVote = Static<typeof TeamVoteSchema>;
export type QuestChoice = Static<typeof QuestChoiceSchema>;
export type QuestResult = Static<typeof QuestResultSchema>;
export type Winner = Static<typeof WinnerSchema>;
export type GameOutcomeReason = Static<typeof GameOutcomeReasonSchema>;
export type CommandType = Static<typeof CommandTypeSchema>;
export type ErrorCode = Static<typeof ErrorCodeSchema>;

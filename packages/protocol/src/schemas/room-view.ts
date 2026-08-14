import { Type, type Static } from '@sinclair/typebox';

import {
  AlignmentSchema,
  CommandTypeSchema,
  GameOutcomeReasonSchema,
  GamePhaseSchema,
  NicknameSchema,
  PhaseStageSchema,
  QuestChoiceSchema,
  QuestResultSchema,
  RoleIdSchema,
  RoomCodeSchema,
  RulesVersionSchema,
  TeamVoteSchema,
  UuidSchema,
  WinnerSchema,
} from './common.js';
import { schemaDocument } from './metadata.js';
import { RoomConfigSchema } from './room-config.js';

export const PlayerSummarySchema = Type.Object(
  {
    playerId: UuidSchema,
    nickname: NicknameSchema,
    seat: Type.Integer({ minimum: 0, maximum: 9 }),
    isHost: Type.Boolean(),
    ready: Type.Boolean(),
    connected: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const SubmissionProgressSchema = Type.Object(
  {
    submittedCount: Type.Integer({ minimum: 0, maximum: 10 }),
    requiredCount: Type.Integer({ minimum: 1, maximum: 10 }),
  },
  { additionalProperties: false },
);

export const TeamVoteRecordSchema = Type.Object(
  { playerId: UuidSchema, vote: TeamVoteSchema },
  { additionalProperties: false },
);

export const ProposalRecordSchema = Type.Object(
  {
    questIndex: Type.Integer({ minimum: 1, maximum: 5 }),
    proposalAttempt: Type.Integer({ minimum: 1, maximum: 5 }),
    leaderPlayerId: UuidSchema,
    teamPlayerIds: Type.Array(UuidSchema, {
      minItems: 2,
      maxItems: 5,
      uniqueItems: true,
    }),
    votes: Type.Array(TeamVoteRecordSchema, { minItems: 5, maxItems: 10 }),
    approveCount: Type.Integer({ minimum: 0, maximum: 10 }),
    rejectCount: Type.Integer({ minimum: 0, maximum: 10 }),
    approved: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const QuestRecordSchema = Type.Object(
  {
    questIndex: Type.Integer({ minimum: 1, maximum: 5 }),
    leaderPlayerId: UuidSchema,
    teamPlayerIds: Type.Array(UuidSchema, {
      minItems: 2,
      maxItems: 5,
      uniqueItems: true,
    }),
    successChoices: Type.Integer({ minimum: 0, maximum: 5 }),
    failChoices: Type.Integer({ minimum: 0, maximum: 5 }),
    requiredFails: Type.Integer({ minimum: 1, maximum: 2 }),
    result: QuestResultSchema,
  },
  { additionalProperties: false },
);

export const AudioCueViewSchema = Type.Object(
  {
    audioCueId: Type.String({ minLength: 1, maxLength: 80 }),
    audioCueKey: Type.String({ pattern: '^[a-z0-9]+(?:[.][a-z0-9]+)*$' }),
    subtitleKey: Type.String({ pattern: '^[a-z0-9]+(?:[.][a-z0-9]+)*$' }),
    voicePackVersion: Type.String({ pattern: '^zh-CN-v[1-9][0-9]*$' }),
  },
  { additionalProperties: false },
);

export const GameOutcomeSchema = Type.Object(
  {
    winner: WinnerSchema,
    reason: GameOutcomeReasonSchema,
    assassinationTargetPlayerId: Type.Optional(
      Type.Union([UuidSchema, Type.Null()]),
    ),
  },
  { additionalProperties: false },
);

export const RevealedAssignmentSchema = Type.Object(
  { playerId: UuidSchema, roleId: RoleIdSchema, alignment: AlignmentSchema },
  { additionalProperties: false },
);

export const PublicSnapshotSchema = Type.Object(
  {
    roomId: UuidSchema,
    roomCode: RoomCodeSchema,
    stateVersion: Type.Integer({ minimum: 0 }),
    rulesVersion: RulesVersionSchema,
    config: RoomConfigSchema,
    phase: GamePhaseSchema,
    phaseStage: PhaseStageSchema,
    players: Type.Array(PlayerSummarySchema, { minItems: 1, maxItems: 10 }),
    leaderPlayerId: Type.Optional(Type.Union([UuidSchema, Type.Null()])),
    questIndex: Type.Optional(
      Type.Union([Type.Integer({ minimum: 1, maximum: 5 }), Type.Null()]),
    ),
    proposalAttempt: Type.Integer({ minimum: 1, maximum: 5 }),
    requiredTeamSize: Type.Optional(
      Type.Union([Type.Integer({ minimum: 2, maximum: 5 }), Type.Null()]),
    ),
    requiredQuestFails: Type.Union([
      Type.Integer({ minimum: 1, maximum: 2 }),
      Type.Null(),
    ]),
    proposedTeamPlayerIds: Type.Array(UuidSchema, {
      maxItems: 5,
      uniqueItems: true,
    }),
    submissionProgress: Type.Optional(
      Type.Union([SubmissionProgressSchema, Type.Null()]),
    ),
    proposalHistory: Type.Array(ProposalRecordSchema, { maxItems: 25 }),
    questHistory: Type.Array(QuestRecordSchema, { maxItems: 5 }),
    successCount: Type.Integer({ minimum: 0, maximum: 3 }),
    failureCount: Type.Integer({ minimum: 0, maximum: 3 }),
    pauseReasons: Type.Array(
      Type.Union([
        Type.Literal('MANUAL'),
        Type.Literal('PLAYER_DISCONNECTED'),
        Type.Literal('HOST_DISCONNECTED'),
      ]),
      { uniqueItems: true },
    ),
    currentAudioCue: Type.Optional(
      Type.Union([AudioCueViewSchema, Type.Null()]),
    ),
    gameOutcome: Type.Optional(Type.Union([GameOutcomeSchema, Type.Null()])),
    revealedAssignments: Type.Optional(
      Type.Array(RevealedAssignmentSchema, { maxItems: 10 }),
    ),
  },
  { additionalProperties: false },
);

export const KnownPlayerSchema = Type.Object(
  {
    playerId: UuidSchema,
    knowledgeLabel: Type.Union([
      Type.Literal('EVIL_PLAYER'),
      Type.Literal('MERLIN_CANDIDATE'),
      Type.Literal('KNOWN_EVIL_ALLY'),
    ]),
  },
  { additionalProperties: false },
);

export const AvailableActionSchema = Type.Object(
  {
    commandType: CommandTypeSchema,
    allowedTeamVotes: Type.Optional(
      Type.Array(TeamVoteSchema, { uniqueItems: true }),
    ),
    allowedQuestChoices: Type.Optional(
      Type.Array(QuestChoiceSchema, { uniqueItems: true }),
    ),
    eligibleTargetPlayerIds: Type.Optional(
      Type.Array(UuidSchema, { maxItems: 9, uniqueItems: true }),
    ),
  },
  { additionalProperties: false },
);

export const PrivatePlayerProjectionSchema = Type.Object(
  {
    playerId: UuidSchema,
    selfRole: Type.Optional(Type.Union([RoleIdSchema, Type.Null()])),
    selfAlignment: Type.Optional(Type.Union([AlignmentSchema, Type.Null()])),
    knownPlayers: Type.Array(KnownPlayerSchema, { maxItems: 9 }),
    availableActions: Type.Array(AvailableActionSchema, { uniqueItems: true }),
    hasSubmitted: Type.Boolean(),
    shouldPlayAudio: Type.Boolean(),
    sessionExpiresAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
);

export const RoomViewSchema = Type.Object(
  {
    public: PublicSnapshotSchema,
    private: PrivatePlayerProjectionSchema,
  },
  { additionalProperties: false },
);

export const RoomViewSchemaDocument = schemaDocument(
  'room-view.schema.json',
  'Avalon personalized room view',
  RoomViewSchema,
);

export type PlayerSummary = Static<typeof PlayerSummarySchema>;
export type PublicSnapshot = Static<typeof PublicSnapshotSchema>;
export type AvailableAction = Static<typeof AvailableActionSchema>;
export type PrivatePlayerProjection = Static<
  typeof PrivatePlayerProjectionSchema
>;
export type RoomView = Static<typeof RoomViewSchema>;

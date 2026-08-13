import { Type, type Static, type TObject } from '@sinclair/typebox';

import {
  CommandTypeSchema,
  QuestChoiceSchema,
  TeamVoteSchema,
  UuidSchema,
} from './common.js';
import { schemaDocument } from './metadata.js';
import { RoomConfigInputSchema } from './room-config.js';

const emptyPayload = Type.Object({}, { additionalProperties: false });

const commandVariant = <T extends string, P extends TObject>(
  type: T,
  payload: P,
) => Type.Object({ type: Type.Literal(type), payload });

const commandVariants = Type.Union([
  commandVariant(
    'ConfigureRoom',
    Type.Object(
      { config: RoomConfigInputSchema },
      { additionalProperties: false },
    ),
  ),
  commandVariant(
    'ReorderSeats',
    Type.Object(
      {
        playerIds: Type.Array(UuidSchema, {
          minItems: 1,
          maxItems: 10,
          uniqueItems: true,
        }),
      },
      { additionalProperties: false },
    ),
  ),
  commandVariant(
    'SetReady',
    Type.Object({ ready: Type.Boolean() }, { additionalProperties: false }),
  ),
  ...[
    'StartGame',
    'ContinuePhase',
    'AckRole',
    'ResumeGame',
    'LeaveLobby',
    'CloseRoom',
  ].map((type) => commandVariant(type, emptyPayload)),
  commandVariant(
    'SubmitTeam',
    Type.Object(
      {
        teamPlayerIds: Type.Array(UuidSchema, {
          minItems: 2,
          maxItems: 5,
          uniqueItems: true,
        }),
      },
      { additionalProperties: false },
    ),
  ),
  commandVariant(
    'SubmitTeamVote',
    Type.Object({ vote: TeamVoteSchema }, { additionalProperties: false }),
  ),
  commandVariant(
    'SubmitQuestChoice',
    Type.Object({ choice: QuestChoiceSchema }, { additionalProperties: false }),
  ),
  commandVariant(
    'SelectMerlinTarget',
    Type.Object(
      { targetPlayerId: UuidSchema },
      { additionalProperties: false },
    ),
  ),
  commandVariant(
    'PauseGame',
    Type.Object(
      { reason: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })) },
      { additionalProperties: false },
    ),
  ),
  commandVariant(
    'ReplayAudioCue',
    Type.Object(
      { audioCueId: Type.String({ minLength: 1, maxLength: 80 }) },
      { additionalProperties: false },
    ),
  ),
  commandVariant(
    'KickLobbyPlayer',
    Type.Object(
      { targetPlayerId: UuidSchema },
      { additionalProperties: false },
    ),
  ),
]);

const commandEnvelope = Type.Object(
  {
    commandId: UuidSchema,
    roomId: UuidSchema,
    expectedStateVersion: Type.Integer({ minimum: 0 }),
    type: CommandTypeSchema,
    payload: Type.Unknown(),
    sentAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
);

export const CommandSchema = Type.Intersect([commandEnvelope, commandVariants]);

export const CommandSchemaDocument = schemaDocument(
  'command.schema.json',
  'Avalon realtime command envelope',
  CommandSchema,
);

export type Command = Static<typeof CommandSchema>;

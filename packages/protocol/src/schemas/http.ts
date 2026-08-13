import { Type, type Static } from '@sinclair/typebox';

import {
  NicknameSchema,
  RoomCodeSchema,
  SessionTokenSchema,
  UuidSchema,
} from './common.js';
import {
  JSON_SCHEMA_DRAFT,
  SCHEMA_BASE_URL,
  type SchemaDocument,
} from './metadata.js';
import { RoomConfigInputSchema } from './room-config.js';
import { RoomViewSchema } from './room-view.js';

export const ClientCapabilitiesSchema = Type.Object(
  {
    protocolVersion: Type.Literal(1),
    platform: Type.Union([Type.Literal('IOS'), Type.Literal('ANDROID')]),
    appVersion: Type.String({ minLength: 1, maxLength: 40 }),
    installationId: Type.Optional(UuidSchema),
    voicePackVersions: Type.Array(
      Type.String({ pattern: '^zh-CN-v[1-9][0-9]*$' }),
      { minItems: 1, maxItems: 5, uniqueItems: true },
    ),
  },
  { additionalProperties: false },
);

export const SessionBootstrapSchema = Type.Object(
  {
    protocolVersion: Type.Literal(1),
    roomCode: RoomCodeSchema,
    playerId: UuidSchema,
    sessionToken: SessionTokenSchema,
    sessionExpiresAt: Type.String({ format: 'date-time' }),
    realtimeUrl: Type.String({ format: 'uri', pattern: '^wss://' }),
    roomView: RoomViewSchema,
  },
  { additionalProperties: false },
);

export const CreateRoomRequestSchema = Type.Object(
  {
    nickname: NicknameSchema,
    config: RoomConfigInputSchema,
    client: ClientCapabilitiesSchema,
  },
  { additionalProperties: false },
);

export const JoinRoomRequestSchema = Type.Object(
  { nickname: NicknameSchema, client: ClientCapabilitiesSchema },
  { additionalProperties: false },
);

export const ResumeSessionRequestSchema = Type.Object(
  { client: ClientCapabilitiesSchema },
  { additionalProperties: false },
);

export const ReadRoomViewResponseSchema = Type.Object(
  { protocolVersion: Type.Literal(1), roomView: RoomViewSchema },
  { additionalProperties: false },
);

export const HttpSchemaDocument = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: `${SCHEMA_BASE_URL}http.schema.json`,
  title: 'Avalon HTTP request and response bodies',
  $defs: {
    SessionBootstrap: SessionBootstrapSchema,
    CreateRoomRequest: CreateRoomRequestSchema,
    JoinRoomRequest: JoinRoomRequestSchema,
    ClientCapabilities: ClientCapabilitiesSchema,
    ResumeSessionRequest: ResumeSessionRequestSchema,
    ReadRoomViewResponse: ReadRoomViewResponseSchema,
  },
} as const satisfies SchemaDocument;

export type ClientCapabilities = Static<typeof ClientCapabilitiesSchema>;
export type SessionBootstrap = Static<typeof SessionBootstrapSchema>;
export type CreateRoomRequest = Static<typeof CreateRoomRequestSchema>;
export type JoinRoomRequest = Static<typeof JoinRoomRequestSchema>;
export type ResumeSessionRequest = Static<typeof ResumeSessionRequestSchema>;
export type ReadRoomViewResponse = Static<typeof ReadRoomViewResponseSchema>;

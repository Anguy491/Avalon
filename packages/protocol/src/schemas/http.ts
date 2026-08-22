import { Type, type Static } from '@sinclair/typebox';

import {
  NicknameSchema,
  RoomCodeSchema,
  RoleIdSchema,
  SessionTokenSchema,
  UuidSchema,
  WechatIdentityTokenSchema,
} from './common.js';
import {
  PROTOCOL_VERSION,
  JSON_SCHEMA_DRAFT,
  SCHEMA_BASE_URL,
  type SchemaDocument,
} from './metadata.js';
import { RoomConfigInputSchema } from './room-config.js';
import { RoomViewSchema } from './room-view.js';

export const ClientCapabilitiesSchema = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    platform: Type.Union([
      Type.Literal('IOS'),
      Type.Literal('ANDROID'),
      Type.Literal('WECHAT_MINIPROGRAM'),
    ]),
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
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
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
  { protocolVersion: Type.Literal(PROTOCOL_VERSION), roomView: RoomViewSchema },
  { additionalProperties: false },
);

export const WechatLoginRequestSchema = Type.Object(
  { loginCode: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: false },
);

export const WechatIdentityBootstrapSchema = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    wechatIdentityToken: WechatIdentityTokenSchema,
    expiresAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
);

export const RoomConfigValidationRequestSchema = Type.Object(
  {
    playerCount: Type.Integer({ minimum: 5, maximum: 10 }),
    roleIds: Type.Array(RoleIdSchema, { minItems: 0, maxItems: 10 }),
  },
  { additionalProperties: false },
);

export const RoomConfigValidationErrorCodeSchema = Type.Union([
  Type.Literal('INVALID_PLAYER_COUNT'),
  Type.Literal('ROLE_COUNT_MISMATCH'),
  Type.Literal('ALIGNMENT_COUNT_MISMATCH'),
  Type.Literal('MERLIN_REQUIRED_ONCE'),
  Type.Literal('ASSASSIN_REQUIRED_ONCE'),
  Type.Literal('UNIQUE_ROLE_REPEATED'),
  Type.Literal('MORGANA_REQUIRES_PERCIVAL'),
  Type.Literal('FIVE_PLAYER_PERCIVAL_REQUIRES_DECEPTION_ROLE'),
]);

export const RoomConfigValidationErrorSchema = Type.Object(
  {
    code: RoomConfigValidationErrorCodeSchema,
    roleId: Type.Optional(RoleIdSchema),
  },
  { additionalProperties: false },
);

export const RoomConfigValidationResponseSchema = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    valid: Type.Boolean(),
    errors: Type.Array(RoomConfigValidationErrorSchema, { maxItems: 10 }),
  },
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
    WechatLoginRequest: WechatLoginRequestSchema,
    WechatIdentityBootstrap: WechatIdentityBootstrapSchema,
    RoomConfigValidationRequest: RoomConfigValidationRequestSchema,
    RoomConfigValidationError: RoomConfigValidationErrorSchema,
    RoomConfigValidationResponse: RoomConfigValidationResponseSchema,
  },
} as const satisfies SchemaDocument;

export type ClientCapabilities = Static<typeof ClientCapabilitiesSchema>;
export type SessionBootstrap = Static<typeof SessionBootstrapSchema>;
export type CreateRoomRequest = Static<typeof CreateRoomRequestSchema>;
export type JoinRoomRequest = Static<typeof JoinRoomRequestSchema>;
export type ResumeSessionRequest = Static<typeof ResumeSessionRequestSchema>;
export type ReadRoomViewResponse = Static<typeof ReadRoomViewResponseSchema>;
export type WechatLoginRequest = Static<typeof WechatLoginRequestSchema>;
export type WechatIdentityBootstrap = Static<
  typeof WechatIdentityBootstrapSchema
>;
export type RoomConfigValidationRequest = Static<
  typeof RoomConfigValidationRequestSchema
>;
export type RoomConfigValidationErrorCode = Static<
  typeof RoomConfigValidationErrorCodeSchema
>;
export type RoomConfigValidationError = Static<
  typeof RoomConfigValidationErrorSchema
>;
export type RoomConfigValidationResponse = Static<
  typeof RoomConfigValidationResponseSchema
>;

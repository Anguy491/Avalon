import { Type, type Static } from '@sinclair/typebox';

import {
  SessionTokenSchema,
  UuidSchema,
  WechatIdentityTokenSchema,
} from './common.js';
import { ErrorDetailSchema } from './error.js';
import {
  PROTOCOL_VERSION,
  JSON_SCHEMA_DRAFT,
  SCHEMA_BASE_URL,
  type SchemaDocument,
} from './metadata.js';
import { RoomViewSchema } from './room-view.js';

export const RealtimeAuthSchema = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    sessionToken: SessionTokenSchema,
    wechatIdentityToken: Type.Optional(WechatIdentityTokenSchema),
    lastStateVersion: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const ResyncRoomViewSchema = Type.Composite([
  RoomViewSchema,
  Type.Object({
    private: Type.Composite([
      RoomViewSchema.properties.private,
      Type.Object({ shouldPlayAudio: Type.Literal(false) }),
    ]),
  }),
]);

export const SessionReadySchema = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    delivery: Type.Literal('RESYNC'),
    roomView: ResyncRoomViewSchema,
  },
  { additionalProperties: false },
);

const liveRoomViewMessage = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    delivery: Type.Literal('LIVE'),
    eventId: UuidSchema,
    roomView: RoomViewSchema,
  },
  { additionalProperties: false },
);

const resyncRoomViewMessage = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    delivery: Type.Literal('RESYNC'),
    eventId: UuidSchema,
    roomView: ResyncRoomViewSchema,
  },
  { additionalProperties: false },
);

export const RoomViewMessageSchema = Type.Union([
  liveRoomViewMessage,
  resyncRoomViewMessage,
]);

export const SessionPingSchema = Type.Object(
  { protocolVersion: Type.Literal(PROTOCOL_VERSION) },
  { additionalProperties: false },
);

export const SessionPongSchema = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    serverTime: Type.String({ format: 'date-time' }),
    sessionExpiresAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
);

export const SessionRevokedSchema = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    reason: Type.Union([
      Type.Literal('SESSION_REPLACED'),
      Type.Literal('SESSION_INVALID'),
      Type.Literal('ROOM_EXPIRED'),
    ]),
    diagnosticId: Type.String({ minLength: 8, maxLength: 64 }),
  },
  { additionalProperties: false },
);

export const ServerMaintenanceSchema = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    startsAt: Type.String({ format: 'date-time' }),
    retryAfterMs: Type.Integer({ minimum: 0, maximum: 3_600_000 }),
    diagnosticId: Type.String({ minLength: 8, maxLength: 64 }),
  },
  { additionalProperties: false },
);

export const AudioTelemetrySchema = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    category: Type.Union([
      Type.Literal('ASSET_MISSING'),
      Type.Literal('HASH_MISMATCH'),
      Type.Literal('LOAD_FAILED'),
      Type.Literal('PLAYBACK_INTERRUPTED'),
    ]),
    platform: Type.Union([
      Type.Literal('ios'),
      Type.Literal('android'),
      Type.Literal('wechat_miniprogram'),
    ]),
    appVersion: Type.String({ minLength: 1, maxLength: 32 }),
    voicePackVersion: Type.Literal('zh-CN-v1'),
  },
  { additionalProperties: false },
);

export const TerminalViewAckSchema = Type.Object(
  { stateVersion: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);

export const TerminalViewAckResultSchema = Type.Object(
  { accepted: Type.Boolean() },
  { additionalProperties: false },
);

export const CommandAcceptedSchema = Type.Object(
  {
    commandId: UuidSchema,
    accepted: Type.Literal(true),
    stateVersion: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const CommandRejectedSchema = Type.Object(
  {
    commandId: UuidSchema,
    accepted: Type.Literal(false),
    error: ErrorDetailSchema,
  },
  { additionalProperties: false },
);

export const CommandResultSchema = Type.Union([
  CommandAcceptedSchema,
  CommandRejectedSchema,
]);

export const TransportSchemaDocument = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: `${SCHEMA_BASE_URL}transport.schema.json`,
  title: 'Avalon Socket.IO transport messages',
  $defs: {
    RealtimeAuth: RealtimeAuthSchema,
    SessionReady: SessionReadySchema,
    RoomViewMessage: RoomViewMessageSchema,
    SessionPing: SessionPingSchema,
    SessionPong: SessionPongSchema,
    SessionRevoked: SessionRevokedSchema,
    ServerMaintenance: ServerMaintenanceSchema,
    AudioTelemetry: AudioTelemetrySchema,
    TerminalViewAck: TerminalViewAckSchema,
    TerminalViewAckResult: TerminalViewAckResultSchema,
    CommandAccepted: CommandAcceptedSchema,
    CommandRejected: CommandRejectedSchema,
    CommandResult: CommandResultSchema,
  },
} as const satisfies SchemaDocument;

export type RealtimeAuth = Static<typeof RealtimeAuthSchema>;
export type SessionReady = Static<typeof SessionReadySchema>;
export type RoomViewMessage = Static<typeof RoomViewMessageSchema>;
export type SessionPing = Static<typeof SessionPingSchema>;
export type SessionPong = Static<typeof SessionPongSchema>;
export type SessionRevoked = Static<typeof SessionRevokedSchema>;
export type ServerMaintenance = Static<typeof ServerMaintenanceSchema>;
export type AudioTelemetry = Static<typeof AudioTelemetrySchema>;
export type TerminalViewAck = Static<typeof TerminalViewAckSchema>;
export type TerminalViewAckResult = Static<typeof TerminalViewAckResultSchema>;
export type CommandResult = Static<typeof CommandResultSchema>;

import { Type, type Static } from '@sinclair/typebox';

import { SessionTokenSchema, UuidSchema } from './common.js';
import { ErrorDetailSchema } from './error.js';
import {
  JSON_SCHEMA_DRAFT,
  SCHEMA_BASE_URL,
  type SchemaDocument,
} from './metadata.js';
import { RoomViewSchema } from './room-view.js';

export const RealtimeAuthSchema = Type.Object(
  {
    protocolVersion: Type.Literal(1),
    sessionToken: SessionTokenSchema,
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
    protocolVersion: Type.Literal(1),
    delivery: Type.Literal('RESYNC'),
    roomView: ResyncRoomViewSchema,
  },
  { additionalProperties: false },
);

const liveRoomViewMessage = Type.Object(
  {
    protocolVersion: Type.Literal(1),
    delivery: Type.Literal('LIVE'),
    eventId: UuidSchema,
    roomView: RoomViewSchema,
  },
  { additionalProperties: false },
);

const resyncRoomViewMessage = Type.Object(
  {
    protocolVersion: Type.Literal(1),
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
export type TerminalViewAck = Static<typeof TerminalViewAckSchema>;
export type TerminalViewAckResult = Static<typeof TerminalViewAckResultSchema>;
export type CommandResult = Static<typeof CommandResultSchema>;

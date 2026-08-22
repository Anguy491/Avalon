import generatedContracts from './generated/mobile-contracts.json' with { type: 'json' };
import type {
  AudioTelemetry,
  CommandResult,
  ErrorResponse,
  ReadRoomViewResponse,
  RoomViewMessage,
  SessionBootstrap,
  SessionPing,
  SessionPong,
  SessionReady,
  SessionRevoked,
  ServerMaintenance,
  TerminalViewAckResult,
  WechatIdentityBootstrap,
  RoomConfigValidationResponse,
} from './schemas/index.js';

interface JsonSchema {
  readonly additionalProperties?: boolean;
  readonly allOf?: readonly JsonSchema[];
  readonly anyOf?: readonly JsonSchema[];
  readonly const?: unknown;
  readonly format?: string;
  readonly items?: JsonSchema;
  readonly maximum?: number;
  readonly maxItems?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly minItems?: number;
  readonly minLength?: number;
  readonly pattern?: string;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly type?:
    | 'array'
    | 'boolean'
    | 'integer'
    | 'null'
    | 'number'
    | 'object'
    | 'string';
  readonly uniqueItems?: boolean;
}

interface MobileContracts {
  readonly audioTelemetry: JsonSchema;
  readonly errorResponse: JsonSchema;
  readonly readRoomViewResponse: JsonSchema;
  readonly roomViewMessage: JsonSchema;
  readonly sessionPing: JsonSchema;
  readonly sessionPong: JsonSchema;
  readonly sessionRevoked: JsonSchema;
  readonly serverMaintenance: JsonSchema;
  readonly sessionBootstrap: JsonSchema;
  readonly sessionReady: JsonSchema;
  readonly commandResult: JsonSchema;
  readonly terminalViewAckResult: JsonSchema;
  readonly wechatIdentityBootstrap: JsonSchema;
  readonly roomConfigValidationResponse: JsonSchema;
}

const contracts = generatedContracts as unknown as MobileContracts;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableValue).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function matchesFormat(format: string, value: string): boolean {
  if (format === 'uuid') {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value,
    );
  }
  if (format === 'date-time') {
    return (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
        value,
      ) && Number.isFinite(Date.parse(value))
    );
  }
  if (format === 'uri') {
    return /^[A-Za-z][A-Za-z\d+.-]*:\/\/[^\s]+$/u.test(value);
  }
  return false;
}

function matchesType(schema: JsonSchema, value: unknown): boolean {
  switch (schema.type) {
    case undefined:
      return true;
    case 'array':
      return Array.isArray(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'null':
      return value === null;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'object':
      return isRecord(value);
    case 'string':
      return typeof value === 'string';
  }
  return false;
}

function matchesSchema(schema: JsonSchema, value: unknown): boolean {
  if (schema.anyOf !== undefined) {
    if (!schema.anyOf.some((candidate) => matchesSchema(candidate, value))) {
      return false;
    }
  }
  if (schema.allOf !== undefined) {
    if (!schema.allOf.every((candidate) => matchesSchema(candidate, value))) {
      return false;
    }
  }
  if (Object.hasOwn(schema, 'const') && !Object.is(schema.const, value)) {
    return false;
  }
  if (!matchesType(schema, value)) return false;

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
  }

  if (typeof value === 'string') {
    const length = Array.from(value).length;
    if (schema.minLength !== undefined && length < schema.minLength) {
      return false;
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      return false;
    }
    if (
      schema.pattern !== undefined &&
      !new RegExp(schema.pattern, 'u').test(value)
    ) {
      return false;
    }
    if (schema.format !== undefined && !matchesFormat(schema.format, value)) {
      return false;
    }
  }

  if (Array.isArray(value)) {
    const itemSchema = schema.items;
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return false;
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return false;
    }
    if (
      schema.uniqueItems === true &&
      new Set(value.map((item) => stableValue(item))).size !== value.length
    ) {
      return false;
    }
    if (
      itemSchema !== undefined &&
      !value.every((item) => matchesSchema(itemSchema, item))
    ) {
      return false;
    }
  }

  if (isRecord(value)) {
    const properties = schema.properties ?? {};
    if (
      schema.required !== undefined &&
      !schema.required.every((key) => Object.hasOwn(value, key))
    ) {
      return false;
    }
    if (
      !Object.entries(properties).every(
        ([key, propertySchema]) =>
          !Object.hasOwn(value, key) ||
          matchesSchema(propertySchema, value[key]),
      )
    ) {
      return false;
    }
    if (
      schema.additionalProperties === false &&
      Object.keys(value).some((key) => !Object.hasOwn(properties, key))
    ) {
      return false;
    }
  }

  return true;
}

export function isErrorResponse(value: unknown): value is ErrorResponse {
  return matchesSchema(contracts.errorResponse, value);
}

export function isAudioTelemetry(value: unknown): value is AudioTelemetry {
  return matchesSchema(contracts.audioTelemetry, value);
}

export function isSessionPing(value: unknown): value is SessionPing {
  return matchesSchema(contracts.sessionPing, value);
}

export function isSessionPong(value: unknown): value is SessionPong {
  return matchesSchema(contracts.sessionPong, value);
}

export function isSessionRevoked(value: unknown): value is SessionRevoked {
  return matchesSchema(contracts.sessionRevoked, value);
}

export function isServerMaintenance(
  value: unknown,
): value is ServerMaintenance {
  return matchesSchema(contracts.serverMaintenance, value);
}

export function isReadRoomViewResponse(
  value: unknown,
): value is ReadRoomViewResponse {
  return matchesSchema(contracts.readRoomViewResponse, value);
}

export function isRoomViewMessage(value: unknown): value is RoomViewMessage {
  return matchesSchema(contracts.roomViewMessage, value);
}

export function isSessionBootstrap(value: unknown): value is SessionBootstrap {
  return matchesSchema(contracts.sessionBootstrap, value);
}

export function isSessionReady(value: unknown): value is SessionReady {
  return matchesSchema(contracts.sessionReady, value);
}

export function isCommandResult(value: unknown): value is CommandResult {
  return matchesSchema(contracts.commandResult, value);
}

export function isTerminalViewAckResult(
  value: unknown,
): value is TerminalViewAckResult {
  return matchesSchema(contracts.terminalViewAckResult, value);
}

export function isWechatIdentityBootstrap(
  value: unknown,
): value is WechatIdentityBootstrap {
  return matchesSchema(contracts.wechatIdentityBootstrap, value);
}

export function isRoomConfigValidationResponse(
  value: unknown,
): value is RoomConfigValidationResponse {
  return matchesSchema(contracts.roomConfigValidationResponse, value);
}

export type {
  AudioTelemetry,
  ClientCapabilities,
  Command,
  CommandResult,
  CommandType,
  CreateRoomRequest,
  ErrorCode,
  ErrorDetail,
  JoinRoomRequest,
  ReadRoomViewResponse,
  RoomConfigInput,
  RoomConfigValidationError,
  RoomConfigValidationErrorCode,
  RoomConfigValidationRequest,
  RoomConfigValidationResponse,
  RoomView,
  RoomViewMessage,
  SessionBootstrap,
  SessionPing,
  SessionPong,
  SessionReady,
  SessionRevoked,
  ServerMaintenance,
  TerminalViewAckResult,
  WechatIdentityBootstrap,
  WechatLoginRequest,
} from './schemas/index.js';

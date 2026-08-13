import { CommandSchemaDocument } from './command.js';
import { CommonSchemaDocument } from './common.js';
import { ErrorSchemaDocument } from './error.js';
import { HttpSchemaDocument } from './http.js';
import type { SchemaDocument } from './metadata.js';
import { RoomConfigSchemaDocument } from './room-config.js';
import { RoomViewSchemaDocument } from './room-view.js';
import { TransportSchemaDocument } from './transport.js';

export const schemaDocuments: Readonly<Record<string, SchemaDocument>> = {
  'command.schema.json': CommandSchemaDocument,
  'common.schema.json': CommonSchemaDocument,
  'error.schema.json': ErrorSchemaDocument,
  'http.schema.json': HttpSchemaDocument,
  'room-config.schema.json': RoomConfigSchemaDocument,
  'room-view.schema.json': RoomViewSchemaDocument,
  'transport.schema.json': TransportSchemaDocument,
};

export * from './command.js';
export * from './common.js';
export * from './error.js';
export * from './http.js';
export * from './metadata.js';
export * from './room-config.js';
export * from './room-view.js';
export * from './transport.js';

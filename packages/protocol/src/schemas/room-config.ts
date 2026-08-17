import { Type, type Static } from '@sinclair/typebox';

import { RoleIdSchema, RulesVersionSchema } from './common.js';
import {
  JSON_SCHEMA_DRAFT,
  SCHEMA_BASE_URL,
  type SchemaDocument,
} from './metadata.js';

export const PresetRoleSelectionSchema = Type.Object(
  {
    type: Type.Literal('PRESET'),
    presetId: Type.Union([
      Type.Literal('CLASSIC'),
      Type.Literal('RECOMMENDED'),
    ]),
  },
  { additionalProperties: false },
);

export const CustomRoleSelectionSchema = Type.Object(
  {
    type: Type.Literal('CUSTOM'),
    roleIds: Type.Array(RoleIdSchema, { minItems: 5, maxItems: 10 }),
  },
  { additionalProperties: false },
);

export const RoomConfigInputSchema = Type.Object(
  {
    rulesVersion: RulesVersionSchema,
    playerCount: Type.Integer({ minimum: 5, maximum: 10 }),
    roleSelection: Type.Union([
      PresetRoleSelectionSchema,
      CustomRoleSelectionSchema,
    ]),
    locale: Type.Literal('zh-CN'),
  },
  { additionalProperties: false },
);

export const RoomConfigSchema = Type.Object(
  {
    rulesVersion: RulesVersionSchema,
    playerCount: Type.Integer({ minimum: 5, maximum: 10 }),
    roleIds: Type.Array(RoleIdSchema, { minItems: 5, maxItems: 10 }),
    locale: Type.Literal('zh-CN'),
    voicePackVersion: Type.String({ pattern: '^zh-CN-v[1-9][0-9]*$' }),
  },
  { additionalProperties: false },
);

export const RoomConfigSchemaDocument: SchemaDocument = {
  ...RoomConfigInputSchema,
  $schema: JSON_SCHEMA_DRAFT,
  $id: `${SCHEMA_BASE_URL}room-config.schema.json`,
  title: 'Avalon room configuration',
  $defs: {
    PresetRoleSelection: PresetRoleSelectionSchema,
    CustomRoleSelection: CustomRoleSelectionSchema,
    RoomConfigInput: RoomConfigInputSchema,
    RoomConfig: RoomConfigSchema,
  },
};

export type RoomConfigInput = Static<typeof RoomConfigInputSchema>;
export type RoomConfig = Static<typeof RoomConfigSchema>;

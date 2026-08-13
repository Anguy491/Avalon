import { Type, type Static } from '@sinclair/typebox';

import { ErrorCodeSchema } from './common.js';
import { schemaDocument } from './metadata.js';

export const FieldErrorSchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 120 }),
    reason: Type.Union([
      Type.Literal('REQUIRED'),
      Type.Literal('INVALID_FORMAT'),
      Type.Literal('OUT_OF_RANGE'),
      Type.Literal('CONFLICT'),
      Type.Literal('DEPENDENCY'),
      Type.Literal('UNSUPPORTED'),
    ]),
  },
  { additionalProperties: false },
);

export const ErrorDetailSchema = Type.Object(
  {
    code: ErrorCodeSchema,
    diagnosticId: Type.String({ minLength: 8, maxLength: 64 }),
    retryable: Type.Boolean(),
    retryAfterMs: Type.Optional(
      Type.Integer({ minimum: 0, maximum: 3_600_000 }),
    ),
    currentStateVersion: Type.Optional(Type.Integer({ minimum: 0 })),
    fieldErrors: Type.Optional(Type.Array(FieldErrorSchema, { maxItems: 20 })),
  },
  { additionalProperties: false },
);

export const ErrorResponseSchema = Type.Object(
  { error: ErrorDetailSchema },
  { additionalProperties: false },
);

export const ErrorSchemaDocument = schemaDocument(
  'error.schema.json',
  'Avalon stable error response',
  ErrorResponseSchema,
);

export type ErrorDetail = Static<typeof ErrorDetailSchema>;
export type ErrorResponse = Static<typeof ErrorResponseSchema>;

import type { TSchema } from '@sinclair/typebox';

export const JSON_SCHEMA_DRAFT =
  'https://json-schema.org/draft/2020-12/schema' as const;
export const SCHEMA_BASE_URL = 'https://avalon.example/schemas/v1/' as const;

export type SchemaDocument = Readonly<Record<string, unknown>> & {
  readonly $schema: typeof JSON_SCHEMA_DRAFT;
  readonly $id: string;
  readonly title: string;
};

export function schemaDocument<T extends TSchema>(
  filename: string,
  title: string,
  schema: T,
): T & SchemaDocument {
  return {
    ...schema,
    $schema: JSON_SCHEMA_DRAFT,
    $id: `${SCHEMA_BASE_URL}${filename}`,
    title,
  } as T & SchemaDocument;
}

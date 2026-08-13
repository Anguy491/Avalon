import { describe, expect, it } from 'vitest';

import { JSON_SCHEMA_DRAFT, schemaDocuments } from './schemas/index.js';

describe('M0-005 protocol schema registry', () => {
  it('exports the seven documented Draft 2020-12 schema files', () => {
    expect(Object.keys(schemaDocuments).sort()).toEqual(
      [
        'command.schema.json',
        'common.schema.json',
        'error.schema.json',
        'http.schema.json',
        'room-config.schema.json',
        'room-view.schema.json',
        'transport.schema.json',
      ].sort(),
    );
    const drafts: string[] = Object.values(schemaDocuments).map(
      (schema) => schema.$schema,
    );
    expect(new Set(drafts)).toEqual(new Set([JSON_SCHEMA_DRAFT]));
  });
});

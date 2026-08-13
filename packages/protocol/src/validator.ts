import type { AnySchema, Options, ValidateFunction } from 'ajv';
import Ajv2020Import from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';

import { schemaDocuments } from './schemas/index.js';

export interface ProtocolValidatorEngine {
  addSchema(schema: AnySchema): this;
  compile(schema: AnySchema): ValidateFunction;
  getSchema(schemaId: string): ValidateFunction | undefined;
}

type AjvConstructor = new (options?: Options) => ProtocolValidatorEngine;

const Ajv2020 = Ajv2020Import as unknown as AjvConstructor;
const addFormats = addFormatsImport as unknown as (
  ajv: ProtocolValidatorEngine,
) => ProtocolValidatorEngine;

export function createProtocolValidator(): ProtocolValidatorEngine {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: true,
  });
  addFormats(ajv);

  for (const schema of Object.values(schemaDocuments)) {
    ajv.addSchema(schema as AnySchema);
  }

  return ajv;
}

export function requireSchema(
  ajv: ProtocolValidatorEngine,
  schemaId: string,
): ValidateFunction {
  const validate = ajv.getSchema(schemaId);
  if (validate === undefined) {
    throw new Error(`Protocol schema not registered: ${schemaId}`);
  }
  return validate;
}

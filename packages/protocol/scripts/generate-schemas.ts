import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { schemaDocuments } from '../src/schemas/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(packageRoot, '../../docs/contracts');
const checkOnly = process.argv.includes('--check');
const driftedFiles: string[] = [];

for (const [filename, schema] of Object.entries(schemaDocuments)) {
  const outputPath = resolve(outputDirectory, filename);
  const generated = `${JSON.stringify(schema, null, 2)}\n`;

  if (checkOnly) {
    const existing = await readFile(outputPath, 'utf8');
    if (existing !== generated) {
      driftedFiles.push(filename);
    }
  } else {
    await writeFile(outputPath, generated, 'utf8');
  }
}

if (driftedFiles.length > 0) {
  throw new Error(
    `Generated protocol snapshots are stale: ${driftedFiles.join(', ')}. Run pnpm protocol:generate.`,
  );
}

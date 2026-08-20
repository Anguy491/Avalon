import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const outputRoot = resolve(import.meta.dirname, '..', 'dist');
const unresolvedEnvironmentReference = /\bprocess\.env\.TARO_APP_[A-Z0-9_]+\b/g;

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(path)));
    else files.push(path);
  }
  return files;
}

const files = await filesIn(outputRoot).catch(() => {
  throw new Error('Missing dist output. Run build:weapp before this check.');
});
const failures = [];
for (const file of files.filter((path) => path.endsWith('.js'))) {
  const source = await readFile(file, 'utf8');
  const references = [...source.matchAll(unresolvedEnvironmentReference)].map(
    (match) => match[0],
  );
  if (references.length > 0) {
    failures.push(
      `${relative(outputRoot, file)}: ${[...new Set(references)].join(', ')}`,
    );
  }
}

if (failures.length > 0) {
  throw new Error(
    `Unresolved Node.js environment references in WeChat output:\n${failures.join('\n')}`,
  );
}

process.stdout.write('WeChat runtime compatibility check passed.\n');

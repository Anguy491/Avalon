import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(path)));
    if (entry.isFile() && entry.name.endsWith('.md')) files.push(path);
  }
  return files;
}

const files = [
  resolve(repositoryRoot, 'README.md'),
  resolve(repositoryRoot, 'AGENTS.md'),
  ...(await markdownFiles(resolve(repositoryRoot, 'docs'))),
];
const failures = [];

for (const file of files) {
  const contents = await readFile(file, 'utf8');
  const links = contents.matchAll(/\[[^\]]*\]\(([^)]+)\)/g);
  for (const match of links) {
    const target = match[1]?.trim();
    if (
      target === undefined ||
      target.startsWith('http://') ||
      target.startsWith('https://') ||
      target.startsWith('#') ||
      target.startsWith('mailto:')
    ) {
      continue;
    }
    const pathWithoutAnchor = decodeURIComponent(target.split('#')[0] ?? '');
    if (pathWithoutAnchor.length === 0) continue;
    try {
      await access(resolve(dirname(file), pathWithoutAnchor));
    } catch {
      failures.push(
        `${relative(repositoryRoot, file)} has a broken link: ${target}`,
      );
    }
  }
}

const requiredTraceRanges = {
  RULE: 22,
  SM: 21,
  FR: 47,
  NFR: 24,
  AC: 15,
  UX: 16,
  TM: 10,
};
const corpus = (
  await Promise.all(files.map((file) => readFile(file, 'utf8')))
).join('\n');

for (const [prefix, maximum] of Object.entries(requiredTraceRanges)) {
  for (let number = 1; number <= maximum; number += 1) {
    const identifier = `${prefix}-${String(number).padStart(3, '0')}`;
    if (!corpus.includes(identifier)) {
      failures.push(`Missing trace identifier: ${identifier}`);
    }
  }
}

const roomViewSchema = await readFile(
  resolve(repositoryRoot, 'docs/contracts/room-view.schema.json'),
  'utf8',
);
for (const forbidden of [
  'roleAssignments',
  'privateKnowledge',
  'questChoices',
  'teamVotes',
  'sessionToken',
]) {
  if (roomViewSchema.includes(`"${forbidden}"`)) {
    failures.push(`RoomView schema contains forbidden field: ${forbidden}`);
  }
}

if (failures.length > 0) {
  throw new Error(`Documentation checks failed:\n- ${failures.join('\n- ')}`);
}

process.stdout.write(
  `Checked ${files.length} Markdown files and trace ranges.\n`,
);

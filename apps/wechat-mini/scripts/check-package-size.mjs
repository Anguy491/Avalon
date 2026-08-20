import { readdir, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'dist');
const limits = { package: 2 * 1024 * 1024, total: 20 * 1024 * 1024 };

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

const files = await filesIn(root).catch(() => {
  throw new Error('Missing dist output. Run build:weapp before test:size.');
});
const sizes = { main: 0, room: 0, game: 0 };
for (const file of files) {
  const path = relative(root, file);
  const bucket = path.startsWith('room/')
    ? 'room'
    : path.startsWith('game/')
      ? 'game'
      : 'main';
  sizes[bucket] += (await stat(file)).size;
}
const total = Object.values(sizes).reduce((sum, size) => sum + size, 0);
for (const [name, size] of Object.entries(sizes)) {
  if (size > limits.package) {
    throw new Error(
      `${name} package is ${(size / 1024 / 1024).toFixed(2)} MiB; limit is 2 MiB.`,
    );
  }
}
if (total > limits.total) {
  throw new Error(
    `Total package size is ${(total / 1024 / 1024).toFixed(2)} MiB; limit is 20 MiB.`,
  );
}
process.stdout.write(`${JSON.stringify({ ...sizes, total })}\n`);

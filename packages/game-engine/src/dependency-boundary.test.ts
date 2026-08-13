import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GAME_ENGINE_MILESTONE, type RandomBytesPort } from './index.js';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const productionSources = readdirSync(sourceDirectory)
  .filter(
    (filename) => filename.endsWith('.ts') && !filename.endsWith('.test.ts'),
  )
  .map((filename) => ({
    filename,
    source: readFileSync(join(sourceDirectory, filename), 'utf8'),
  }));

describe('M1-007 game-engine dependency boundary', () => {
  it('exposes injectable deterministic ports', () => {
    const random: RandomBytesPort = {
      bytes: (length) => new Uint8Array(length).fill(7),
    };
    expect(GAME_ENGINE_MILESTONE).toBe('M1_RULES_COMPLETE');
    expect([...random.bytes(3)]).toEqual([7, 7, 7]);
  });

  it.each([
    [
      'network',
      /from ['"](?:node:)?(?:http|https|net|tls|dgram)|\bfetch\s*\(/u,
    ],
    ['database', /from ['"](?:pg|postgres|redis|ioredis|prisma|typeorm)/u],
    ['UI', /from ['"](?:react|react-native|expo|@expo|fastify|socket\.io)/u],
    ['system randomness', /Math[.]random\s*\(|randomBytes\s*\(/u],
    ['system time', /Date[.]now\s*\(|new\s+Date\s*\(/u],
  ] as const)('has no direct %s dependency', (_name, forbidden) => {
    for (const { filename, source } of productionSources) {
      expect(source, filename).not.toMatch(forbidden);
    }
  });

  it('declares no network, database, server, or UI package dependency', () => {
    const packageJson = JSON.parse(
      readFileSync(join(sourceDirectory, '../package.json'), 'utf8'),
    ) as { readonly dependencies?: Readonly<Record<string, string>> };
    expect(Object.keys(packageJson.dependencies ?? {})).toEqual([]);
  });
});

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(
  root,
  'apps/mobile/assets/audio/zh-CN-v1/manifest.json',
);
const outputPath = resolve(
  root,
  'apps/mobile/src/audio/voice-pack.generated.ts',
);

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
const complete =
  manifest.status === 'approved' &&
  manifest.rightsReviewed === true &&
  entries.length > 0 &&
  entries.every(
    (entry) =>
      typeof entry.file === 'string' &&
      /^[0-9a-f]{64}$/u.test(entry.sha256 ?? '') &&
      /^[0-9a-f]{64}$/u.test(entry.subtitleSha256 ?? ''),
  );

const source = [
  "import type { AudioSource } from 'expo-audio';",
  '',
  `export const VOICE_PACK_VERSION = ${JSON.stringify(manifest.version)} as const;`,
  `export const VOICE_PACK_READY: boolean = ${String(complete)};`,
  '',
  'export const VOICE_PACK_ENTRIES = {',
  ...entries.map(
    (entry) =>
      `  ${JSON.stringify(entry.key)}: { subtitle: ${JSON.stringify(entry.subtitle)} },`,
  ),
  '} as const;',
  '',
  'export type VoicePackKey = keyof typeof VOICE_PACK_ENTRIES;',
  '',
  'const AUDIO_SOURCES: Partial<Record<VoicePackKey, AudioSource>> = {',
  ...entries
    .filter((entry) => typeof entry.file === 'string')
    .map(
      (entry) =>
        `  ${JSON.stringify(entry.key)}: require(${JSON.stringify(`../../assets/audio/zh-CN-v1/${entry.file}`)}) as number,`,
    ),
  '};',
  '',
  'export function audioSourceFor(key: VoicePackKey): AudioSource | undefined {',
  '  return AUDIO_SOURCES[key];',
  '}',
  '',
  'export function supportedVoicePackVersions(): readonly string[] {',
  '  // Subtitle fallback supports the rules flow even before audio is approved.',
  '  return [VOICE_PACK_VERSION];',
  '}',
  '',
].join('\n');
const lines = await format(source, { parser: 'typescript', singleQuote: true });

if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  if (current !== lines) {
    process.stderr.write('Audio pack generated module is stale.\n');
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, lines);
}

if (process.argv.includes('--verify-assets')) {
  const failures = [];
  if (!complete) failures.push('manifest is not approved and complete');
  for (const entry of entries) {
    const subtitleDigest = createHash('sha256')
      .update(entry.subtitle ?? '', 'utf8')
      .digest('hex');
    if (subtitleDigest !== entry.subtitleSha256) {
      failures.push(`${entry.key}: subtitle hash mismatch`);
    }
    if (typeof entry.file !== 'string') {
      failures.push(`${entry.key}: audio file missing`);
      continue;
    }
    const bytes = await readFile(
      resolve(dirname(manifestPath), entry.file),
    ).catch(() => undefined);
    if (bytes === undefined) {
      failures.push(`${entry.key}: declared audio file missing`);
      continue;
    }
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
      failures.push(`${entry.key}: audio hash mismatch`);
    }
  }
  if (failures.length > 0) {
    process.stderr.write(`${failures.join('\n')}\n`);
    process.exitCode = 1;
  }
}

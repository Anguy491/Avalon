import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(
  root,
  'apps/mobile/assets/audio/zh-CN-v1/manifest.json',
);
const expoOutputPath = resolve(
  root,
  'apps/mobile/src/audio/voice-pack.generated.ts',
);
const wechatOutputPath = resolve(
  root,
  'apps/wechat-mini/src/audio/voice-pack.generated.ts',
);

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
const requiredUsageScopes = [
  'INTERNAL_PREVIEW',
  'PUBLIC_WECHAT_MINIPROGRAM',
  'PUBLIC_IOS_ANDROID',
];
const usageScopes = Array.isArray(manifest.usageScopes)
  ? manifest.usageScopes
  : [];
const requiredRightsRecord = 'docs/assets/audio-zh-CN-v1-rights.zh-CN.md';
const rightsRecord =
  manifest.rightsRecord === requiredRightsRecord
    ? await readFile(resolve(root, requiredRightsRecord), 'utf8').catch(
        () => '',
      )
    : '';
const publicRightsApproved =
  rightsRecord.includes('审核结论：通过') &&
  rightsRecord.includes('微信小程序及 iOS/Android 应用公开发布');
const complete =
  manifest.status === 'approved' &&
  manifest.rightsReviewed === true &&
  publicRightsApproved &&
  requiredUsageScopes.every((scope) => usageScopes.includes(scope)) &&
  entries.length > 0 &&
  entries.every(
    (entry) =>
      typeof entry.file === 'string' &&
      /^[0-9a-f]{64}$/u.test(entry.sha256 ?? '') &&
      /^[0-9a-f]{64}$/u.test(entry.subtitleSha256 ?? ''),
  );

const expoSource = [
  '/* eslint-disable @typescript-eslint/no-require-imports -- Expo local assets require static require() calls. */',
  "import type { AudioSource } from 'expo-audio';",
  '',
  `export const VOICE_PACK_VERSION = ${JSON.stringify(manifest.version)} as const;`,
  `export const VOICE_PACK_READY: boolean = ${String(complete)};`,
  '',
  'export const VOICE_PACK_ENTRIES = {',
  ...entries.map(
    (entry) =>
      `  ${JSON.stringify(entry.key)}: { subtitle: ${JSON.stringify(entry.subtitle)}, subtitleSha256: ${JSON.stringify(entry.subtitleSha256)}, sha256: ${JSON.stringify(entry.sha256)}, file: ${JSON.stringify(entry.file)} },`,
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
const expoLines = await format(expoSource, {
  parser: 'typescript',
  singleQuote: true,
});

const wechatSource = [
  `export const VOICE_PACK_VERSION = ${JSON.stringify(manifest.version)} as const;`,
  `export const VOICE_PACK_READY: boolean = ${String(complete)};`,
  '',
  'export const VOICE_PACK_ENTRIES = {',
  ...entries.map(
    (entry) =>
      `  ${JSON.stringify(entry.key)}: { subtitle: ${JSON.stringify(entry.subtitle)}, subtitleSha256: ${JSON.stringify(entry.subtitleSha256)}, sha256: ${JSON.stringify(entry.sha256)}, source: ${JSON.stringify(`/assets/audio/zh-CN-v1/${entry.file}`)} },`,
  ),
  '} as const;',
  '',
  'export type VoicePackKey = keyof typeof VOICE_PACK_ENTRIES;',
  '',
  'export function voicePackEntryFor(key: string) {',
  '  return Object.prototype.hasOwnProperty.call(VOICE_PACK_ENTRIES, key)',
  '    ? VOICE_PACK_ENTRIES[key as VoicePackKey]',
  '    : undefined;',
  '}',
  '',
].join('\n');
const wechatLines = await format(wechatSource, {
  parser: 'typescript',
  singleQuote: true,
});

if (process.argv.includes('--check')) {
  const [currentExpo, currentWechat] = await Promise.all([
    readFile(expoOutputPath, 'utf8').catch(() => ''),
    readFile(wechatOutputPath, 'utf8').catch(() => ''),
  ]);
  if (currentExpo !== expoLines || currentWechat !== wechatLines) {
    process.stderr.write('Audio pack generated modules are stale.\n');
    process.exitCode = 1;
  }
} else {
  await Promise.all([
    writeFile(expoOutputPath, expoLines),
    writeFile(wechatOutputPath, wechatLines),
  ]);
}

if (process.argv.includes('--verify-assets')) {
  const failures = [];
  if (!complete) failures.push('manifest is not approved and complete');
  if (!publicRightsApproved) {
    failures.push('public release rights record is missing or not approved');
  }
  for (const scope of requiredUsageScopes) {
    if (!usageScopes.includes(scope)) {
      failures.push(`manifest lacks required usage scope: ${scope}`);
    }
  }
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
  const declaredFiles = new Set(entries.map((entry) => entry.file));
  const packagedFiles = (await readdir(dirname(manifestPath))).filter((file) =>
    file.endsWith('.mp3'),
  );
  for (const file of packagedFiles) {
    if (!declaredFiles.has(file))
      failures.push(`${file}: undeclared audio file`);
  }
  if (failures.length > 0) {
    process.stderr.write(`${failures.join('\n')}\n`);
    process.exitCode = 1;
  }
}

import { spawnSync } from 'node:child_process';

import { validatePreviewEnvironment } from './preview-config.mjs';

const failures = validatePreviewEnvironment(process.env);
const audio = spawnSync(
  process.execPath,
  ['scripts/generate-audio-pack.mjs', '--check', '--verify-assets'],
  { cwd: process.cwd(), encoding: 'utf8' },
);
if (audio.status !== 0) {
  failures.push(`audio pack failed: ${(audio.stderr || audio.stdout).trim()}`);
}

if (failures.length > 0) {
  process.stderr.write(
    `PREVIEW_READY_NOT_DEPLOYED check failed:\n- ${failures.join('\n- ')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    'Preview configuration and immutable assets are ready.\n',
  );
}

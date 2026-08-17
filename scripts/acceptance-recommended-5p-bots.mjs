import { resolve } from 'node:path';

import {
  parseAcceptanceBotArgs,
  runAcceptanceBots,
} from './acceptance-bots.mjs';

function usage() {
  return `Usage:
  pnpm acceptance:bots:recommended-5p -- --room-code ABCDEF [options]

Create a 5-player room with “推荐配置” in the native app first. The script
validates the exact public deck, joins four bots, and defaults to happy-path.`;
}

export function recommendedFivePlayerOptions(argv) {
  return parseAcceptanceBotArgs([
    ...argv,
    '--expected-config',
    'recommended-5p',
    '--bots',
    '4',
  ]);
}

if (
  process.argv[1] !== undefined &&
  import.meta.filename === resolve(process.argv[1])
) {
  try {
    const options = recommendedFivePlayerOptions(process.argv.slice(2));
    if (options.help) process.stdout.write(`${usage()}\n`);
    else await runAcceptanceBots(options);
  } catch (error) {
    process.stderr.write(
      `acceptance:bots:recommended-5p failed: ${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`,
    );
    process.exitCode = 1;
  }
}

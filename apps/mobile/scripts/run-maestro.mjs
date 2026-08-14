import { spawn } from 'node:child_process';

import { maestroEnvironment } from './maestro-environment.mjs';

const flows = process.argv.slice(2);
if (flows.length === 0)
  throw new Error('At least one Maestro flow is required');

for (const flow of flows) {
  const exitCode = await new Promise((resolveExit, reject) => {
    const child = spawn('maestro', ['test', flow], {
      env: maestroEnvironment(),
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(`Maestro flow failed: ${flow}`);
  }
}

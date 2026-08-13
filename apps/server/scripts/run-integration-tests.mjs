import { execFileSync, spawnSync } from 'node:child_process';

const environment = { ...process.env };

if (environment.DOCKER_HOST === undefined) {
  try {
    environment.DOCKER_HOST = execFileSync(
      'docker',
      ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    // Testcontainers will report the actionable runtime error.
  }
}

if (
  environment.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE === undefined &&
  environment.DOCKER_HOST?.includes('/.colima/') === true
) {
  environment.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE = '/var/run/docker.sock';
}

const result = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', '--config', 'vitest.integration.config.ts'],
  { env: environment, stdio: 'inherit' },
);

if (result.error !== undefined) throw result.error;
process.exit(result.status ?? 1);

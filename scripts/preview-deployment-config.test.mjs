import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deploymentRoot = resolve(repositoryRoot, 'deploy/preview');

test('Preview compose preserves the private deployment boundary', async () => {
  const composePlugin = spawnSync('docker', ['compose', 'version'], {
    encoding: 'utf8',
  });
  const composeCommand =
    composePlugin.status === 0 ? 'docker' : 'docker-compose';
  const composePrefix = composePlugin.status === 0 ? ['compose'] : [];
  const result = spawnSync(
    composeCommand,
    [
      ...composePrefix,
      '--env-file',
      resolve(deploymentRoot, '.env.example'),
      '--file',
      resolve(deploymentRoot, 'compose.yaml'),
      'config',
      '--format',
      'json',
    ],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const config = JSON.parse(result.stdout);
  const services = config.services;

  for (const name of ['postgres', 'redis', 'migrator', 'server', 'proxy']) {
    assert.equal(
      services[name].ports,
      undefined,
      `${name} must not publish ports`,
    );
  }
  assert.match(services.server.image, /avalon-server@sha256:[0-9a-f]{64}$/u);
  assert.match(
    services.migrator.image,
    /avalon-migrator@sha256:[0-9a-f]{64}$/u,
  );
  assert.equal(
    services.server.environment.TRUSTED_PROXY_CIDRS,
    '172.31.77.254/32',
  );
  assert.equal(
    services.server.depends_on.migrator.condition,
    'service_completed_successfully',
  );
  assert.equal(config.networks.private.internal, true);
  assert.match(
    services.postgres.volumes[0].target,
    /^\/var\/lib\/postgresql$/u,
  );
  assert.deepEqual(services.cloudflared.networks, { edge: null });
  assert.deepEqual(services.server.networks, { private: null });
  assert.equal(
    services.proxy.volumes.some(
      (volume) => volume.target === '/srv/.well-known' && volume.read_only,
    ),
    true,
  );
});

test('Preview proxy overwrites forwarded client identity', async () => {
  const caddyfile = await readFile(
    resolve(deploymentRoot, 'Caddyfile'),
    'utf8',
  );

  assert.match(caddyfile, /header_up -Forwarded/u);
  assert.match(
    caddyfile,
    /header_up X-Forwarded-For \{http\.request\.header\.CF-Connecting-IP\}/u,
  );
  assert.match(caddyfile, /header_up X-Forwarded-Proto https/u);
  assert.match(caddyfile, /handle \/\.well-known\/assetlinks\.json/u);
  assert.match(caddyfile, /handle \/\.well-known\/apple-app-site-association/u);
});

test('Preview Android App Links bind the reviewed package and signing certificate', async () => {
  const statements = JSON.parse(
    await readFile(
      resolve(deploymentRoot, 'well-known/assetlinks.json'),
      'utf8',
    ),
  );

  assert.deepEqual(statements, [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'dev.anguy.avalon',
        sha256_cert_fingerprints: [
          '52:96:C7:39:FE:E5:BD:51:C1:70:96:74:8A:70:57:78:57:62:E1:0B:20:FC:84:E4:34:8C:FC:FB:B3:97:E0:B8',
        ],
      },
    },
  ]);
});

test('Preview mobile build exposes Sentry CLI to the native upload task', async () => {
  const mobilePackage = JSON.parse(
    await readFile(resolve(repositoryRoot, 'apps/mobile/package.json'), 'utf8'),
  );

  assert.equal(mobilePackage.devDependencies['@sentry/cli'], '2.58.4');
});

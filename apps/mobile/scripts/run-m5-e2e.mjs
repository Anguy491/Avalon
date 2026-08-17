import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { maestroEnvironment } from './maestro-environment.mjs';

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(mobileRoot, '../..');
const fixturePath = resolve(
  repositoryRoot,
  'apps/server/scripts/prepare-m5-e2e.mjs',
);
const tlsDirectory = resolve(mobileRoot, '.expo/m5-e2e-tls');
const opensslConfig = resolve(mobileRoot, 'e2e/local-tls-openssl.cnf');
const caCertificate = resolve(tlsDirectory, 'ca.crt');
const caKey = resolve(tlsDirectory, 'ca.key');
const serverCertificate = resolve(tlsDirectory, 'server.crt');
const serverKey = resolve(tlsDirectory, 'server.key');
const serverRequest = resolve(tlsDirectory, 'server.csr');
const maestroOutput = resolve(mobileRoot, '.expo/m5-maestro-output');

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${String(result.status)}`);
  }
}

function prepareLocalTls() {
  mkdirSync(tlsDirectory, { recursive: true });
  if (!existsSync(serverCertificate) || !existsSync(serverKey)) {
    run('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      caKey,
      '-out',
      caCertificate,
      '-subj',
      '/CN=Avalon local E2E root',
      '-days',
      '3650',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-addext',
      'keyUsage=critical,keyCertSign,cRLSign',
    ]);
    run('openssl', [
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      serverKey,
      '-out',
      serverRequest,
      '-config',
      opensslConfig,
    ]);
    run('openssl', [
      'x509',
      '-req',
      '-in',
      serverRequest,
      '-CA',
      caCertificate,
      '-CAkey',
      caKey,
      '-CAcreateserial',
      '-out',
      serverCertificate,
      '-days',
      '30',
      '-sha256',
      '-extfile',
      opensslConfig,
      '-extensions',
      'server_cert',
    ]);
  }

  const devices = spawnSync(
    'xcrun',
    ['simctl', 'list', 'devices', 'booted', '--json'],
    { encoding: 'utf8' },
  );
  if (devices.status !== 0)
    throw new Error('Unable to inspect booted simulators');
  const deviceGroups = Object.values(JSON.parse(devices.stdout).devices);
  const bootedDevice = deviceGroups
    .flat()
    .find((device) => device.state === 'Booted');
  if (bootedDevice === undefined)
    throw new Error('A booted iOS Simulator is required');
  run('xcrun', [
    'simctl',
    'keychain',
    bootedDevice.udid,
    'add-root-cert',
    caCertificate,
  ]);
}

function waitForOutput(child, pattern, label) {
  return new Promise((resolveOutput, reject) => {
    let output = '';
    child.once('error', reject);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      output += chunk;
      if (pattern.test(output)) resolveOutput();
    });
    child.once('exit', (code) => {
      reject(
        new Error(`${label} exited before becoming ready (${String(code)})`),
      );
    });
  });
}

function findFile(directory, basename) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(path, basename);
      if (nested !== undefined) return nested;
    } else if (entry.name === basename) {
      return path;
    }
  }
  return undefined;
}

function retainEvidence(mode) {
  for (const name of ['ios-role-guide', 'ios-assassination', 'ios-result']) {
    const basename = `${name}-${mode}.png`;
    const source = findFile(maestroOutput, basename);
    if (source === undefined)
      throw new Error(`Missing M5 evidence ${basename}`);
    copyFileSync(
      source,
      resolve(repositoryRoot, 'docs/verification/m5', basename),
    );
  }
}

function waitForExit(child, label) {
  return new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveExit();
      else reject(new Error(`${label} exited with ${String(code ?? signal)}`));
    });
  });
}

prepareLocalTls();
rmSync(maestroOutput, { recursive: true, force: true });
const proxy = spawn(
  process.execPath,
  [
    resolve(mobileRoot, 'scripts/local-wss-proxy.mjs'),
    serverCertificate,
    serverKey,
  ],
  { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'inherit'] },
);
await waitForOutput(proxy, /LOCAL_WSS_READY=/u, 'local WSS proxy');

const fixture = spawn(
  process.execPath,
  ['--env-file-if-exists=.env', fixturePath],
  {
    cwd: repositoryRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);

let buffered = '';
let roomCode;
const roomReady = new Promise((resolveRoom, reject) => {
  fixture.once('error', reject);
  fixture.stdout.setEncoding('utf8');
  fixture.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    buffered += chunk;
    const match = buffered.match(/M5_E2E_ROOM_CODE=([23456789A-HJ-NP-Z]{6})/u);
    if (match?.[1] !== undefined && roomCode === undefined) {
      roomCode = match[1];
      resolveRoom(roomCode);
    }
  });
  fixture.once('exit', (code) => {
    if (roomCode === undefined) {
      reject(
        new Error(
          `M5 fixture exited before publishing a room (${String(code)})`,
        ),
      );
    }
  });
});

const fixtureExit = waitForExit(fixture, 'M5 fixture');
try {
  const preparedRoomCode = await roomReady;
  const screenshotMode = process.env.M5_E2E_SCREENSHOT_MODE ?? 'large';
  const maestro = spawn(
    'maestro',
    [
      'test',
      '--test-output-dir',
      maestroOutput,
      '-e',
      `ROOM_CODE=${preparedRoomCode}`,
      '-e',
      `SCREENSHOT_MODE=${screenshotMode}`,
      'e2e/m5-assassination-result.yaml',
    ],
    { cwd: mobileRoot, env: maestroEnvironment(), stdio: 'inherit' },
  );
  await Promise.all([waitForExit(maestro, 'Maestro M5 flow'), fixtureExit]);
  retainEvidence(screenshotMode);
} catch (error) {
  fixture.kill('SIGTERM');
  throw error;
} finally {
  proxy.kill('SIGTERM');
}

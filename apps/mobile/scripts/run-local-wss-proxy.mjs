import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const mobileRoot = resolve(import.meta.dirname, '..');
const tlsDirectory = resolve(mobileRoot, '.expo/local-e2e-tls');
const opensslConfig = resolve(mobileRoot, 'e2e/local-tls-openssl.cnf');
const caCertificate = resolve(tlsDirectory, 'ca.crt');
const caKey = resolve(tlsDirectory, 'ca.key');
const serverCertificate = resolve(tlsDirectory, 'server.crt');
const serverKey = resolve(tlsDirectory, 'server.key');
const serverRequest = resolve(tlsDirectory, 'server.csr');

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${String(result.status)}`);
  }
}

function prepareCertificates() {
  mkdirSync(tlsDirectory, { recursive: true });
  if (existsSync(serverCertificate) && existsSync(serverKey)) return;
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
    '/CN=Avalon local acceptance root',
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

function installSimulatorCertificate() {
  const devices = spawnSync(
    'xcrun',
    ['simctl', 'list', 'devices', 'booted', '--json'],
    { encoding: 'utf8' },
  );
  if (devices.status !== 0) {
    throw new Error('Unable to inspect booted iOS simulators');
  }
  const groups = Object.values(JSON.parse(devices.stdout).devices);
  const booted = groups.flat().find((device) => device.state === 'Booted');
  if (booted === undefined) {
    throw new Error(
      'Boot one iOS Simulator before starting the local WSS proxy',
    );
  }
  run('xcrun', [
    'simctl',
    'keychain',
    booted.udid,
    'add-root-cert',
    caCertificate,
  ]);
}

prepareCertificates();
installSimulatorCertificate();

const proxy = spawn(
  process.execPath,
  [
    resolve(mobileRoot, 'scripts/local-wss-proxy.mjs'),
    serverCertificate,
    serverKey,
  ],
  { cwd: repositoryRoot, stdio: 'inherit' },
);

const stop = () => proxy.kill('SIGTERM');
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
proxy.once('exit', (code, signal) => {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  if (code !== 0 && signal === null) process.exitCode = code ?? 1;
});

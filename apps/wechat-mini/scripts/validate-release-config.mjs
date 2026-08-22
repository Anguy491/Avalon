import { isIP } from 'node:net';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { URL } from 'node:url';

const projectRoot = resolve(import.meta.dirname, '..');
const expectedAppId = 'wx0240d55d0f3e4811';

function fail(message) {
  throw new Error(`WeChat release configuration rejected: ${message}`);
}

function forbiddenHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.invalid') ||
    isIP(normalized) !== 0
  );
}

function validateEnvironment() {
  if (process.env.TARO_APP_BUILD_PROFILE !== 'release') {
    fail('TARO_APP_BUILD_PROFILE must be release');
  }
  const apiValue = process.env.TARO_APP_API_URL;
  const joinValue = process.env.TARO_APP_JOIN_HOST;
  const version = process.env.TARO_APP_VERSION;
  if (apiValue === undefined || apiValue.length === 0)
    fail('API URL is missing');
  if (joinValue === undefined || joinValue.length === 0)
    fail('join host is missing');
  if (
    version === undefined ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)
  ) {
    fail('version must be an explicit semantic version');
  }
  let api;
  try {
    api = new URL(apiValue);
  } catch {
    fail('API URL is malformed');
  }
  if (api.protocol !== 'https:') fail('API URL must use HTTPS');
  if (api.username.length > 0 || api.password.length > 0)
    fail('API URL must not contain credentials');
  if (forbiddenHost(api.hostname)) fail('API host is not release-safe');
  if (api.pathname !== '/' || api.search.length > 0 || api.hash.length > 0) {
    fail('API URL must be an origin without path, query, or fragment');
  }
  if (
    joinValue.includes('://') ||
    joinValue.includes('/') ||
    joinValue.includes(':')
  ) {
    fail('join host must be a hostname only');
  }
  if (forbiddenHost(joinValue) || !/^[a-z0-9.-]+$/iu.test(joinValue)) {
    fail('join host is not release-safe');
  }
  return { apiOrigin: api.origin, joinHost: joinValue };
}

async function outputTextFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await outputTextFiles(path)));
    if (entry.isFile() && /\.(?:js|json|wxml|wxss)$/u.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

const projectConfig = JSON.parse(
  await readFile(resolve(projectRoot, 'project.config.json'), 'utf8'),
);
if (projectConfig.appid !== expectedAppId) fail('project AppID does not match');
if (projectConfig.setting?.urlCheck !== true)
  fail('legal-domain checking must be enabled');
if (projectConfig.setting?.minified !== true)
  fail('upload minification must be enabled');
const releaseEnvironment = validateEnvironment();

if (process.argv.includes('--check-output')) {
  const outputRoot = resolve(projectRoot, 'dist');
  const files = await outputTextFiles(outputRoot);
  if (files.length === 0) fail('release output is missing');
  const output = (
    await Promise.all(files.map((file) => readFile(file, 'utf8')))
  ).join('\n');
  for (const forbidden of [
    'http://127.0.0.1:3000',
    'join.example.invalid',
    'localhost.invalid',
  ]) {
    if (output.includes(forbidden)) {
      fail(`release output contains ${forbidden}`);
    }
  }
  if (!output.includes(releaseEnvironment.apiOrigin)) {
    fail('release output does not contain the configured API origin');
  }
  if (!output.includes(releaseEnvironment.joinHost)) {
    fail('release output does not contain the configured join host');
  }
}

process.stdout.write('WeChat release configuration passed.\n');

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'validate-release-config.mjs');
const validEnvironment = {
  ...process.env,
  TARO_APP_BUILD_PROFILE: 'release',
  TARO_APP_API_URL: 'https://api.avalon.example',
  TARO_APP_JOIN_HOST: 'join.avalon.example',
  TARO_APP_VERSION: '1.0.0',
};

function run(overrides = {}) {
  return spawnSync(process.execPath, [script], {
    env: { ...validEnvironment, ...overrides },
    encoding: 'utf8',
  });
}

test('accepts an explicit HTTPS release configuration', () => {
  assert.equal(run().status, 0);
});

for (const [name, overrides] of [
  ['localhost', { TARO_APP_API_URL: 'https://localhost' }],
  ['IP address', { TARO_APP_API_URL: 'https://127.0.0.1' }],
  ['invalid TLD', { TARO_APP_JOIN_HOST: 'join.example.invalid' }],
  ['HTTP', { TARO_APP_API_URL: 'http://api.avalon.example' }],
  ['missing version', { TARO_APP_VERSION: '' }],
]) {
  test(`rejects ${name}`, () => {
    const result = run(overrides);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release configuration rejected/iu);
  });
}

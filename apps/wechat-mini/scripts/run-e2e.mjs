import automator from 'miniprogram-automator';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const MiniProgram = require('miniprogram-automator/out/MiniProgram').default;
const minimumSdkVersion = '2.7.3';

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const count = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < count; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

// DevTools 2.02.2608040 returns only `version` from Tool.getInfo, while
// miniprogram-automator 0.12.1 expects `SDKVersion`. Read the SDK version from
// the public system-info API as a compatible fallback and retain the minimum
// version check instead of disabling it.
MiniProgram.prototype.checkVersion = async function checkVersion() {
  const toolInfo = await this.send('Tool.getInfo');
  const sdkVersion =
    typeof toolInfo.SDKVersion === 'string'
      ? toolInfo.SDKVersion
      : (await this.systemInfo()).SDKVersion;
  if (
    sdkVersion !== 'dev' &&
    (typeof sdkVersion !== 'string' ||
      compareVersions(sdkVersion, minimumSdkVersion) < 0)
  ) {
    throw new Error(
      `WeChat SDKVersion ${String(sdkVersion)} is below required ${minimumSdkVersion}.`,
    );
  }
};

const cliPath = process.env.WECHAT_DEVTOOLS_CLI;
if (cliPath === undefined || cliPath.length === 0) {
  throw new Error('WECHAT_DEVTOOLS_CLI is required for WeChat DevTools E2E.');
}

const miniProgram = await automator.launch({
  cliPath,
  projectPath: resolve(import.meta.dirname, '..'),
  trustProject: true,
});
try {
  const runtimeExceptions = [];
  miniProgram.on('exception', (exception) => {
    runtimeExceptions.push(exception);
  });
  const page = await miniProgram.reLaunch('/pages/index/index');
  await page.waitFor(500);
  if (runtimeExceptions.length > 0) {
    throw new Error(
      `WeChat runtime exception: ${JSON.stringify(runtimeExceptions[0])}`,
    );
  }
  const titles = await page.$$('.title');
  if (titles.length === 0) throw new Error('Home page title was not rendered.');
  const buttons = await page.$$('button');
  if (buttons.length < 3) {
    throw new Error('Expected create, join, and scan actions.');
  }
  const resultDirectory = resolve(import.meta.dirname, '..', 'test-results');
  await mkdir(resultDirectory, { recursive: true });
  await miniProgram.screenshot({ path: resolve(resultDirectory, 'home.png') });
} finally {
  await miniProgram.close();
}

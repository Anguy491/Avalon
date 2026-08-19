import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { launchMiniProgram } from './automator-compat.mjs';

const cliPath = process.env.WECHAT_DEVTOOLS_CLI;
if (cliPath === undefined || cliPath.length === 0) {
  throw new Error('WECHAT_DEVTOOLS_CLI is required for WeChat DevTools E2E.');
}

const miniProgram = await launchMiniProgram({
  cliPath,
  projectPath: resolve(import.meta.dirname, '..'),
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

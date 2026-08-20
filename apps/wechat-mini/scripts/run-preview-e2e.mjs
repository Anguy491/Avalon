import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { launchMiniProgram } from './automator-compat.mjs';

const cliPath = process.env.WECHAT_DEVTOOLS_CLI;
const apiOrigin = process.env.WECHAT_PREVIEW_API_ORIGIN;
const useLegacyPlatformShim =
  process.env.WECHAT_PREVIEW_LEGACY_PLATFORM_SHIM === '1';
if (cliPath === undefined || cliPath.length === 0) {
  throw new Error('WECHAT_DEVTOOLS_CLI is required for Preview E2E.');
}
if (apiOrigin === undefined || !apiOrigin.startsWith('https://')) {
  throw new Error('WECHAT_PREVIEW_API_ORIGIN must be an explicit HTTPS URL.');
}

const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..');
// Use the compiled project directly. Opening the source root through the
// current DevTools automation server can leave its pageframe in `not-found`
// after App.exit even though miniprogramRoot points at dist.
const projectPath = resolve(import.meta.dirname, '..', 'dist');
const resultDirectory = resolve(
  import.meta.dirname,
  '..',
  'test-results',
  'preview',
);
const deadline = Date.now() + 8 * 60_000;

function ensureWithinDeadline() {
  if (Date.now() > deadline) throw new Error('Preview E2E timed out.');
}

function isAutomatorTimeout(error) {
  return (
    error instanceof Error &&
    error.message.includes('timeout waiting for automator response')
  );
}

async function probeMiniProgramNetwork(miniProgram) {
  return await miniProgram.evaluate(
    (origin) =>
      new Promise((resolveRequest) => {
        globalThis.wx.request({
          url: `${origin}/v2/health/ready`,
          method: 'GET',
          success: (response) =>
            resolveRequest({
              kind: 'success',
              statusCode: response.statusCode,
            }),
          fail: (error) =>
            resolveRequest({ kind: 'fail', errorMessage: error.errMsg }),
        });
      }),
    apiOrigin,
  );
}

async function waitForLocalDomainOverride(miniProgram) {
  let result = await probeMiniProgramNetwork(miniProgram);
  if (result.kind === 'success' && result.statusCode === 200) return;

  if (
    result.kind !== 'fail' ||
    !result.errorMessage.includes('url not in domain list')
  ) {
    throw new Error(
      `WeChat Preview network probe failed: ${JSON.stringify(result)}`,
    );
  }
  if (!process.stdin.isTTY) {
    throw new Error(
      'WeChat DevTools blocked the Preview domain. Run this command in a TTY, enable “不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书” in 详情 → 本地设置, then continue.',
    );
  }

  process.stdout.write(
    [
      'WECHAT_PREVIEW_LOCAL_SETTING_REQUIRED',
      'In the active automated DevTools window, open 详情 → 本地设置,',
      'enable “不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书”,',
      'then press Enter here to continue. This affects the simulator only.',
      '',
    ].join('\n'),
  );
  process.stdin.resume();
  await new Promise((resolveInput) => process.stdin.once('data', resolveInput));
  result = await probeMiniProgramNetwork(miniProgram);
  if (result.kind !== 'success' || result.statusCode !== 200) {
    throw new Error(
      `WeChat Preview network probe still failed: ${JSON.stringify(result)}`,
    );
  }
}

async function installLegacyPlatformShim(miniProgram) {
  if (!useLegacyPlatformShim) return;
  await miniProgram.evaluate(() => {
    const originalRequest = globalThis.wx.request.bind(globalThis.wx);
    globalThis.wx.request = (options) => {
      const client = options.data?.client;
      if (client?.platform !== 'WECHAT_MINIPROGRAM') {
        return originalRequest(options);
      }
      return originalRequest({
        ...options,
        data: {
          ...options.data,
          client: { ...client, platform: 'IOS' },
        },
      });
    };
  });
  process.stdout.write(
    'WECHAT_PREVIEW_LEGACY_PLATFORM_SHIM_ACTIVE: this run does not prove deployed WECHAT_MINIPROGRAM protocol support.\n',
  );
}

async function screenshot(miniProgram, name) {
  await mkdir(resultDirectory, { recursive: true });
  await miniProgram.screenshot({
    path: resolve(resultDirectory, `${name}.png`),
  });
}

async function safeScreenshot(miniProgram, name) {
  process.stdout.write(`Preview E2E: capture ${name}\n`);
  try {
    await screenshot(miniProgram, name);
  } catch (error) {
    process.stderr.write(
      `Preview E2E screenshot skipped (${name}): ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

async function buttonEntries(page) {
  const buttons = await page.$$('button');
  return await Promise.all(
    buttons.map(async (button) => ({
      button,
      text: (await button.text()).trim(),
    })),
  );
}

async function tapButton(page, label) {
  const entry = (await buttonEntries(page)).find(({ text }) => text === label);
  if (entry === undefined) return false;
  process.stdout.write(`Preview E2E: tap “${label}”\n`);
  try {
    await entry.button.trigger('tap');
  } catch (error) {
    if (!isAutomatorTimeout(error)) throw error;
    process.stderr.write(
      `Preview E2E: DevTools did not acknowledge “${label}”; verifying the resulting page state.\n`,
    );
  }
  await delay(250);
  return true;
}

async function waitForPath(miniProgram, expectedPath) {
  while (true) {
    ensureWithinDeadline();
    const page = await miniProgram.currentPage();
    if (page?.path === expectedPath) return page;
    const error = await page?.$('.error');
    const errorText = (await error?.text())?.trim();
    if (errorText !== undefined && errorText.length > 0) {
      throw new Error(`WeChat page error before ${expectedPath}: ${errorText}`);
    }
    await delay(200);
  }
}

async function openFromHome(miniProgram, buttonLabel, expectedPath) {
  const home = await miniProgram.reLaunch('/pages/index/index');
  await home.waitFor(300);
  if (!(await tapButton(home, buttonLabel))) {
    throw new Error(`Home action is missing: ${buttonLabel}`);
  }
  return await waitForPath(miniProgram, expectedPath);
}

async function createRecommendedRoom(miniProgram) {
  process.stdout.write('Preview E2E: open create page from home\n');
  let page = await openFromHome(miniProgram, '创建房间', 'pages/create/index');
  await screenshot(miniProgram, '02-create');
  process.stdout.write('Preview E2E: configure recommended 5-player room\n');
  let choices = await page.$$('.choice');
  if (choices.length < 8) throw new Error('Create page choices are missing.');
  await choices[7].trigger('tap');
  await delay(100);
  choices = await page.$$('.choice');
  if (!(await choices[7].attribute('class'))?.includes('choice-selected')) {
    await choices[7].trigger('click');
  }
  await delay(100);
  choices = await page.$$('.choice');
  if (!(await choices[7].attribute('class'))?.includes('choice-selected')) {
    throw new Error('Recommended room mode was not selected.');
  }
  const nickname = await page.$('input');
  if (nickname === null)
    throw new Error('Create page nickname input is missing.');
  await nickname.input('微信验收房主');
  process.stdout.write('Preview E2E: submit create-room request\n');
  if (!(await tapButton(page, '创建房间'))) {
    throw new Error('Create room button is missing.');
  }

  process.stdout.write('Preview E2E: wait for lobby route\n');
  page = await waitForPath(miniProgram, 'room/pages/lobby/index');
  const roomCode = (await (await page.$('.room-code'))?.text())?.trim();
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/u.test(roomCode ?? '')) {
    throw new Error('Lobby did not render a valid room code.');
  }
  return roomCode;
}

async function inspectPublicEntryPages(miniProgram) {
  process.stdout.write('Preview E2E: inspect home, join, and scan pages\n');
  let page = await miniProgram.reLaunch('/pages/index/index');
  await page.waitFor(300);
  await screenshot(miniProgram, '01-home');
  page = await openFromHome(miniProgram, '输入房间号加入', 'pages/join/index');
  await screenshot(miniProgram, '03-join');
  page = await openFromHome(miniProgram, '扫描房间二维码', 'pages/scan/index');
  await screenshot(miniProgram, '04-scan');
}

function startBots(roomCode) {
  const child = spawn(
    'pnpm',
    [
      'acceptance:bots:recommended-5p',
      '--',
      '--room-code',
      roomCode,
      '--api-origin',
      apiOrigin,
    ],
    {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
    process.stderr.write(chunk);
  });
  const completion = new Promise((resolveCompletion, rejectCompletion) => {
    child.once('error', rejectCompletion);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveCompletion(output);
      else {
        rejectCompletion(
          new Error(`Acceptance bots exited with ${String(code ?? signal)}.`),
        );
      }
    });
  });
  return { child, completion };
}

async function selectRequiredTeam(page) {
  const progressItems = await page.$$('.progress');
  const progressTexts = await Promise.all(
    progressItems.map((item) => item.text()),
  );
  const selectionProgress = progressTexts.find((text) =>
    /已选 \d+\/\d+/u.test(text),
  );
  const required = Number(
    /已选 \d+\/(\d+)/u.exec(selectionProgress ?? '')?.[1],
  );
  if (!Number.isInteger(required) || required < 1) {
    throw new Error('Could not determine required team size.');
  }
  const players = await page.$$('.player');
  if (players.length < required) throw new Error('Player list is incomplete.');
  for (const player of players.slice(0, required)) {
    await player.trigger('tap');
  }
}

async function driveHumanHost(miniProgram, bots) {
  const captured = new Set();
  while (true) {
    ensureWithinDeadline();
    try {
      const page = await miniProgram.currentPage();
      if (page === undefined) throw new Error('WeChat page stack is empty.');
      const buttons = await buttonEntries(page);
      const labels = new Set(buttons.map(({ text }) => text));

      if (page.path === 'room/pages/lobby/index') {
        if (labels.has('开始游戏') && !captured.has('lobby-full')) {
          await safeScreenshot(miniProgram, '05-lobby-full');
          captured.add('lobby-full');
        }
        if (await tapButton(page, '我已准备')) continue;
        if (await tapButton(page, '开始游戏')) continue;
      } else if (page.path === 'game/pages/role/index') {
        if (!captured.has('role-hidden')) {
          await safeScreenshot(miniProgram, '06-role-hidden');
          captured.add('role-hidden');
        }
        if (await tapButton(page, '点按揭示身份')) continue;
        if (await tapButton(page, '我已记住身份')) continue;
        if (await tapButton(page, '房主继续')) continue;
      } else if (page.path === 'game/pages/game/index') {
        if (!captured.has('game')) {
          await safeScreenshot(miniProgram, '07-game');
          captured.add('game');
        }
        if (labels.has('提交队伍')) {
          await selectRequiredTeam(page);
          await tapButton(page, '提交队伍');
          continue;
        }
        if (await tapButton(page, '同意队伍')) continue;
        if (await tapButton(page, '任务成功')) continue;
        if (await tapButton(page, '房主继续当前阶段')) continue;
      } else if (page.path === 'game/pages/assassination/index') {
        if (await tapButton(page, '房主开放刺杀选择')) continue;
        if (labels.has('确认刺杀目标')) {
          const targets = await page.$$('.player');
          if (targets.length === 0)
            throw new Error('Assassination targets missing.');
          await targets[0].trigger('tap');
          await tapButton(page, '确认刺杀目标');
          continue;
        }
        if (!captured.has('assassination-waiting')) {
          const pageText = await page.$('.page');
          const text = (await pageText?.text()) ?? '';
          if (!text.includes('你是刺客')) {
            await safeScreenshot(miniProgram, '08-assassination-waiting');
          }
          captured.add('assassination-waiting');
        }
      } else if (page.path === 'game/pages/result/index') {
        await safeScreenshot(miniProgram, '09-result');
        await bots.completion;
        return;
      }
    } catch (error) {
      if (!isAutomatorTimeout(error)) throw error;
      process.stderr.write(
        'Preview E2E: transient DevTools response timeout; retrying current page state.\n',
      );
    }
    await delay(500);
  }
}

const health = await fetch(`${apiOrigin}/v2/health/ready`);
if (!health.ok) {
  throw new Error(`Preview readiness returned HTTP ${String(health.status)}.`);
}

const miniProgram = await launchMiniProgram({ cliPath, projectPath });
let bots;
const runtimeExceptions = [];
try {
  miniProgram.on('exception', (exception) => {
    runtimeExceptions.push(exception);
  });
  await waitForLocalDomainOverride(miniProgram);
  await installLegacyPlatformShim(miniProgram);
  await miniProgram.mockWxMethod('showModal', {
    cancel: false,
    confirm: true,
  });
  await inspectPublicEntryPages(miniProgram);
  const roomCode = await createRecommendedRoom(miniProgram);
  process.stdout.write(`WECHAT_PREVIEW_ROOM=${roomCode}\n`);
  bots = startBots(roomCode);
  await driveHumanHost(miniProgram, bots);
  if (runtimeExceptions.length > 0) {
    throw new Error(
      `WeChat runtime exception: ${JSON.stringify(runtimeExceptions[0])}`,
    );
  }
  process.stdout.write(`WECHAT_PREVIEW_E2E_PASSED=${resultDirectory}\n`);
} finally {
  if (runtimeExceptions.length > 0) {
    process.stderr.write(
      `Preview runtime exception: ${JSON.stringify(runtimeExceptions[0])}\n`,
    );
  }
  if (bots?.child.exitCode === null) bots.child.kill('SIGTERM');
  await miniProgram.close();
}

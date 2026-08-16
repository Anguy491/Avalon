import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { URL } from 'node:url';

import { chromium } from 'playwright';

const ROOM_CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/u;

function usage() {
  return `Usage:
  pnpm acceptance:web -- --room-code ABCDEF [options]

Options:
  --players <1-9>       Independent web players to join; default: 4
  --web-origin <url>    Expo Web URL; default: http://127.0.0.1:8081
  --headless            Run without visible windows
  --screenshots         Save post-join screenshots under output/playwright
  --help                Show this help

Each player runs in a separate Playwright BrowserContext. Web sessions are for
projection/UI inspection only and do not prove native SecureStore recovery.`;
}

function parseInteger(value, name, minimum, maximum) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer between ${String(minimum)} and ${String(maximum)}`,
    );
  }
  return parsed;
}

export function parseWebPlayerArgs(argv) {
  const options = {
    headless: false,
    playerCount: 4,
    roomCode: process.env.ACCEPTANCE_ROOM_CODE,
    screenshots: false,
    webOrigin: process.env.ACCEPTANCE_WEB_ORIGIN ?? 'http://127.0.0.1:8081',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} requires a value`);
      index += 1;
      return value;
    };
    if (argument === '--') continue;
    if (argument === '--help') return { ...options, help: true };
    if (argument === '--room-code') options.roomCode = next();
    else if (argument === '--players') {
      options.playerCount = parseInteger(next(), '--players', 1, 9);
    } else if (argument === '--web-origin') options.webOrigin = next();
    else if (argument === '--headless') options.headless = true;
    else if (argument === '--screenshots') options.screenshots = true;
    else throw new Error(`Unknown argument: ${String(argument)}`);
  }
  options.roomCode = options.roomCode?.trim().toUpperCase();
  options.webOrigin = options.webOrigin.trim().replace(/\/$/u, '');
  if (!ROOM_CODE_PATTERN.test(options.roomCode ?? '')) {
    throw new Error('--room-code must be a complete six-character room code');
  }
  try {
    const parsed = new URL(options.webOrigin);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new Error('--web-origin must be an HTTP(S) URL');
  }
  return options;
}

function waitUntilStopped() {
  return new Promise((resolveStop) => {
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      resolveStop();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    if (process.stdin.isTTY) {
      process.stdin.setEncoding('utf8');
      process.stdin.once('data', stop);
      process.stdin.resume();
    }
  });
}

export async function runWebPlayers(options) {
  const browser = await chromium.launch({ headless: options.headless });
  const contexts = [];
  try {
    const screenshotDirectory = resolve('output/playwright');
    if (options.screenshots) {
      await mkdir(screenshotDirectory, { recursive: true });
    }
    for (let index = 0; index < options.playerCount; index += 1) {
      const context = await browser.newContext({
        colorScheme: index % 2 === 0 ? 'light' : 'dark',
        ignoreHTTPSErrors: true,
        locale: 'zh-CN',
        viewport: {
          height: index % 3 === 0 ? 844 : 740,
          width: index % 3 === 0 ? 390 : 360,
        },
      });
      contexts.push(context);
      const page = await context.newPage();
      await page.goto(`${options.webOrigin}/join/${options.roomCode}`, {
        waitUntil: 'domcontentloaded',
      });
      await page
        .getByLabel('你的昵称')
        .fill(`Web验收${String(index + 1).padStart(2, '0')}`);
      await page.getByRole('button', { name: '加入房间' }).click();
      await page.getByText('房间号', { exact: true }).waitFor({
        state: 'visible',
        timeout: 15_000,
      });
      if (options.screenshots) {
        await page.screenshot({
          fullPage: true,
          path: resolve(
            screenshotDirectory,
            `web-player-${String(index + 1).padStart(2, '0')}-lobby.png`,
          ),
        });
      }
      process.stdout.write(
        `Web 玩家 ${String(index + 1)} 已在独立 BrowserContext 加入\n`,
      );
    }
    process.stdout.write(
      [
        `已启动 ${String(contexts.length)} 个隔离 Web 会话。`,
        '可并排检查不同玩家投影；按 Enter 或 Ctrl+C 关闭全部会话。',
        '不要把刷新后的 Web 恢复结果记为原生 SecureStore 证据。',
      ].join('\n') + '\n',
    );
    await waitUntilStopped();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await browser.close();
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.filename === resolve(process.argv[1])
) {
  try {
    const options = parseWebPlayerArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(`${usage()}\n`);
    else await runWebPlayers(options);
  } catch (error) {
    process.stderr.write(
      `acceptance:web failed: ${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`,
    );
    process.exitCode = 1;
  }
}

# 单模拟器多玩家验收手册

> 追踪：`AC-001`–`AC-015`；本手册只使用正式 HTTP/Socket 协议，不提供生产测试后门。

## 1. 测试分层

- 一个 iOS Simulator 或真机保留给真人房主，用于主持推进、音频、扫码、SecureStore、后台遮罩和无障碍验证。
- `acceptance:bots` 使用 4–9 个无界面会话填满房间，执行准备、身份确认、Bot 队长组队、投票、任务行动和 Bot 刺杀。
- `acceptance:web` 为每位 Web 玩家建立独立 Playwright BrowserContext，用于并排观察页面和个性化投影；Web 内存会话刷新即丢失，不得记为原生恢复证据。
- Bot 模式和 Web 玩家模式会占用真实座位；同一房间应二选一，或显式减少各自数量。

Bot 进程只在内存中读取自己的 `RoomView.private`。生成的 JSON 证据仅记录公开结果、命令类型和 `stateVersion`，不保存 token、角色、知识、票值、任务选择、玩家 ID 或昵称。

## 2. 本地环境

先启动 PostgreSQL/Redis 并迁移数据库：

```bash
pnpm dev:deps
pnpm --filter @avalon/server db:migrate
```

启动一台 iOS Simulator，然后分别启动服务端、本地 WSS 入口和 Metro：

```bash
REALTIME_PUBLIC_URL=wss://localhost:3443/game-v2 pnpm --filter @avalon/server dev
pnpm dev:wss
EXPO_PUBLIC_API_URL=http://127.0.0.1:3000 pnpm --filter @avalon/mobile dev
```

`dev:wss` 首次运行会在被忽略的 `apps/mobile/.expo/` 下生成本地 CA/证书，将 CA 加入当前已启动的 Simulator，并监听 `3443`。它不会改变线上协议或系统全局信任。

在原生 App 中由真人创建目标人数房间，保持真人为房主。使用规范测试昵称，不使用真实姓名。

## 3. 人类房主 + Bot

Bot 可直接连接本地 HTTP Socket.IO 入口，同时原生 App 继续使用受信任的本地 WSS：

```bash
ACCEPTANCE_REALTIME_URL=http://127.0.0.1:3000/game-v2 \
pnpm acceptance:bots -- --room-code ABCDEF --scenario happy-path
```

默认根据房间配置自动填满剩余座位。若房间中另有人工/Web 玩家，使用 `--bots <数量>`。驱动器不会替真人点击房主专属的开始、继续、暂停/恢复或音频重播；终端会在每个等待点给出操作提示。

通用 `acceptance:bots` 不限定基础或推荐配置；它会按房间当前服务端投影运行。若要专门手测 5 人推荐配置，先在 App 中以“5 人 + 推荐配置”建房，再运行：

```bash
ACCEPTANCE_REALTIME_URL=http://127.0.0.1:3000/game-v2 \
pnpm acceptance:bots:recommended-5p -- --room-code ABCDEF
```

该入口固定加入 4 个 Bot，并在行动前校验公开角色数组必须精确为梅林、派西维尔、忠臣、莫甘娜、刺客；若误建成基础配置，会先让用于读取配置的 Bot 退出大厅，再立即报错且不产生通过证据。默认执行 `happy-path`，也可追加其他适用于 5 人局的 `--scenario`。

| 场景 | 人数 | 命令 | 主要证据 |
| --- | ---: | --- | --- |
| 五轮正常流程 | 5–10 | `--scenario happy-path` | `AC-001/002/007/008/015` |
| 3:3 平票 | 6 | `--scenario tie-vote` | `AC-003`；首轮真人投同意 |
| 连续五次否决 | 5–10 | `--scenario five-rejections` | `AC-004` |
| 第四轮一张失败 | 7–10 | `--scenario fourth-quest-single-fail` | `AC-006` 成功分支 |
| 第四轮两张失败 | 7–10 | `--scenario fourth-quest-double-fail` | `AC-006` 失败分支 |
| 刺杀命中/未命中 | 5–10 | `--scenario assassination-hit` / `assassination-miss` | `AC-007`；若真人随机成为刺客，改用既有 M5 定向原生 E2E 或重开房间 |
| 已投票玩家断线恢复 | 5–10 | `--scenario reconnect` | `AC-009/010/011`；默认断线 20 秒 |

通过后，脱敏报告写入 `output/acceptance/`。该目录被 Git 忽略；需要纳入发布材料时，仅人工选择不含秘密的摘要和截图复制到对应 `docs/verification/` 目录。

## 4. 独立 Web 玩家

首次使用安装仓库锁定的 Chromium：

```bash
pnpm exec playwright install chromium
```

启动 Expo Web，然后让独立上下文加入原生房主创建的房间：

```bash
EXPO_PUBLIC_API_URL=http://127.0.0.1:3000 pnpm --filter @avalon/mobile web
pnpm acceptance:web -- --room-code ABCDEF --players 4
```

每个窗口具有独立 Cookie、Local/Session Storage 和 JS 内存。使用 `--screenshots` 可将大厅截图保存到 `output/playwright/`；截图前确认全部使用测试昵称。按 Enter 或 `Ctrl+C` 关闭所有上下文。

Web 只覆盖共享 React 页面、响应布局、表单和投影视角。相机权限、Universal Link、SecureStore、AppState 隐私遮罩、系统音频中断、VoiceOver/TalkBack 和原生网络恢复必须在原生构建验证。

## 5. 今日验收顺序

1. 执行 `format:check`、`lint`、`typecheck`、`test`、`test:contract`、`test:integration`、`test:security`、`docs:check` 与 `secret:scan`。
2. 对已启动的隔离服务执行 `pnpm test:load`，验证 20 房、5–10 人完整协议流。
3. 运行原生房主 + Bot 的正常、平票、五拒、第四轮单双失败、刺杀和断线场景。
4. 使用独立 Web 上下文并排检查不同视角；重点确认公开模型、错误、控制台和截图无未公开秘密。
5. 在 iOS/Android 原生环境人工验证拒绝相机、后台遮罩、进程重启恢复、最大字体、读屏、静音和断网；正式音频到位后补电话/闹钟/蓝牙中断与主动重播。
6. 音频和 Preview 环境配置完成后运行 `pnpm preview:check`；不得跳过失败项。

## 6. 发布边界

多玩家逻辑通过不代表外部邀请就绪。正式音频与授权、`AC-014`、支持系统真机矩阵、1,000 房/10,000 连接 30 分钟容量测试、真实监控告警、签名、迁移/回滚和隐私/法律门槛仍按 M7/M8 文档执行。

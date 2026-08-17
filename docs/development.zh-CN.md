# Avalon 本地开发、配置与验证

> 状态：M0 工程基线 + M2 会话/房间 + M3 大厅/身份揭示增量
>
> 追踪：`M0-001`–`M0-009`、`ADR-001`–`ADR-007`、`TEST-contract`、`TM-002`、`TM-004`、`TM-008`

## 1. 锁定工具链

| 工具       | 仓库版本/策略                                                                      |
| ---------- | ---------------------------------------------------------------------------------- |
| Node.js    | `24.19.0`，Node 24 Active LTS 系列；`.node-version`、根 `engines` 与服务端容器一致 |
| pnpm       | `11.16.0`，由根 `packageManager` 锁定；只保留一个 `pnpm-lock.yaml`                 |
| Expo       | 稳定 SDK 56 / React Native 0.85；移动依赖由 Expo 模板与 `npx expo install` 固定    |
| PostgreSQL | 本地/测试镜像 `postgres:18.1-alpine3.22`                                           |
| Redis      | 本地/测试镜像 `redis:8.2.3-alpine3.22`                                             |

依赖更新由 Dependabot 每周提出独立变更；Expo SDK 升级必须单独 Issue，并重新执行 Expo doctor、CNG 预构建和双平台原生回归。普通 TypeScript 依赖使用 `pnpm --filter <workspace> add`；Expo 原生/生态依赖只在 `apps/mobile` 运行 `npx expo install <package>`。

## 2. 从干净 checkout 启动

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm dev:deps
pnpm --filter @avalon/server db:migrate
pnpm dev
```

`pnpm dev:deps` 使用供应商无关的本地 PostgreSQL/Redis。迁移由 `node-pg-migrate` 管理；`000001` 建立运行时 schema，`000002` 建立 M2 暂态房间、玩家、会话、幂等、Outbox 与终局回执表。

常用入口：

- Metro/Expo：终端显示的开发客户端或 Expo Go 地址；
- 服务存活：`http://127.0.0.1:3000/v2/health/live`；
- 服务就绪：`http://127.0.0.1:3000/v2/health/ready`；
- 停止依赖：`pnpm dev:deps:down`。

健康响应只返回 `ok/ready/not_ready`，不包含依赖地址、版本、房间或秘密配置。

## 3. 配置允许列表

应用只读取下列字段：

| 字段                                    | 作用                | 秘密             |
| --------------------------------------- | ------------------- | ---------------- |
| `NODE_ENV`、`HOST`、`PORT`、`LOG_LEVEL` | 进程与日志级别      | 否               |
| `DATABASE_URL`、`REDIS_URL`             | 本地/部署适配器连接 | 是，禁止日志     |
| `RATE_LIMIT_MAX`                        | 基础入口限流        | 否               |
| `RATE_LIMIT_HMAC_SECRET`                | 对限流来源键做 HMAC | 是，至少 32 字符 |
| `JOIN_RATE_LIMIT_MAX`                   | 每分钟创建/加入上限 | 否               |
| `SESSION_TOKEN_PEPPER`                  | SessionToken 摘要   | 是，至少 32 字符 |
| `IDEMPOTENCY_ENCRYPTION_SECRET`         | 加密幂等响应        | 是，至少 32 字符 |
| `SESSION_TTL_SECONDS`                   | 会话有效期          | 否               |
| `REALTIME_PUBLIC_URL`                   | bootstrap WSS 地址  | 否               |

Compose 另外读取 `POSTGRES_DB/USER/PASSWORD`，仅用于本地容器。`.env` 不进入 Git；`.env.example` 只含不可复用占位值。服务端禁止请求体自动日志，并显式删减 Authorization、SessionToken、角色、知识、票与任务行动路径。pepper、幂等加密密钥和限流 HMAC 密钥必须彼此独立；Preview/Production 由秘密管理系统注入，不得使用示例值。

移动构建读取 `EXPO_PUBLIC_API_URL`、`EXPO_PUBLIC_JOIN_HOST` 与 `EXPO_ENABLE_IOS_ASSOCIATED_DOMAINS`。开发默认 API 为 `http://127.0.0.1:3000`，公开加入 host 为不可发布占位值；本地 iOS Simulator 默认不生成 Associated Domains entitlement，避免无证书的模拟器构建被原生签名能力阻断。随机安装 UUID 只存在于 SecureStore，并只用于组合限流。

Preview/Production（或需要在真机验证 Universal Links 的 Development Build）必须同时设置真实 HTTPS host 和 `EXPO_ENABLE_IOS_ASSOCIATED_DOMAINS=1`，再重新生成/构建原生应用。例如：

```bash
EXPO_PUBLIC_JOIN_HOST=anguy.dev \
EXPO_ENABLE_IOS_ASSOCIATED_DOMAINS=1 \
pnpm --filter @avalon/mobile exec expo prebuild --platform ios --clean
```

启用后，iOS entitlement 为 `applinks:<EXPO_PUBLIC_JOIN_HOST>`；该 host 必须通过无重定向的 HTTPS 在 `/.well-known/apple-app-site-association` 提供 AASA 文件，且其中 App ID 必须匹配 Apple Team ID 与最终 `ios.bundleIdentifier`。这类构建仍需要 Apple 开发团队、证书和 provisioning profile。仅做本地 Simulator 开发时不要设置该开关；`EXPO_PUBLIC_JOIN_HOST` 仍可设为真实域名，用于生成/解析加入链接，但不会声明 Universal Links entitlement。Preview/Production 还必须配置 Android App Links 和服务端 `REALTIME_PUBLIC_URL`。

## 4. 生成协议

`packages/protocol/src/schemas` 是唯一编辑源：

```bash
pnpm protocol:generate
pnpm test:contract
pnpm docs:check
```

生成器写入 `docs/contracts/*.schema.json`；CI 在快照漂移、未知字段被接受、秘密字段进入 `RoomView` 或 `RESYNC` 请求自动播放时失败。

## 5. 必需检查

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contract
pnpm test:integration
pnpm test:e2e:mobile
pnpm test:load
pnpm docs:check
pnpm secret:scan
pnpm build
```

`pnpm test:e2e:mobile` 运行 Maestro 的 M2 原生创建/错误/拒权流程和 M5 刺杀/终局/清理流程，需要已安装 Development Build、Maestro、运行中的 API 与 Metro。当前 M5 本地终局夹具使用 iOS Simulator；先以 `REALTIME_PUBLIC_URL=wss://localhost:3443/game-v2 pnpm --filter @avalon/server dev` 启动 API，再以 `EXPO_PUBLIC_API_URL=http://localhost:3000 pnpm --filter @avalon/mobile dev` 启动 Metro。M5 runner 会在被 `.gitignore` 排除的 `apps/mobile/.expo/` 下生成仅供本地测试的 CA/服务端证书，将 CA 加入当前已启动模拟器，并在 `3443` 端口启动到 API `3000` 端口的临时 TLS 代理；线上协议仍只接受 `wss://`，测试不会放宽为明文 WebSocket。Android 模拟器执行 M2 流程时另需 `adb reverse tcp:8081 tcp:8081` 和 API 端口反向映射；M5 的 Android 原生矩阵仍需配置信任测试 CA 的专用构建后执行。

`pnpm test:load` 针对已启动服务执行默认 20 个并发房，人数循环覆盖 5–10 人。每房完成 `SetReady → StartGame（含同 commandId 重放）→ 全员 AckRole → 五次组队/投票/任务结算`，确定性结果为成功、失败、成功、失败、成功。脚本断言：

- 创建/加入 p95 不超过 `NFR-002` 的 2 秒；命令 ack 和最终个性化投影 p95 不超过 `NFR-003` 的 1 秒；
- HTTP/命令零错误、重放不增加 `stateVersion`，最终全部房间具有五条匿名任务历史并到达 `QUEST_RESOLUTION/RESOLVED`；
- 每条实时投影的 `roomId`/私密 `playerId` 与连接绑定一致，公开快照不含角色、知识、票或任务私密字段。

可用 `LOAD_BASE_URL` 指向隔离服务端口，用 `LOAD_ROOM_COUNT` 在 1–1,000 内调整房间数；服务端的本地限流配置必须容纳对应请求量。该脚本是短时 M4 多房间烟测，不是 `NFR-004` 的 1,000 房/10,000 连接、持续 30 分钟候选发布验证。

单台模拟器配合 4–9 个协议 Bot、定向验收场景和独立 Web BrowserContext 的操作见[多玩家验收手册](./acceptance-multiplayer.zh-CN.md)。

## 6. Development Build 与 CNG

移动端提供 `development`、`preview`、`production` 三个 EAS profile，并安装 `expo-dev-client`。原生目录由 CNG 生成且不提交：

```bash
cd apps/mobile
npx expo start --go
npx expo prebuild --clean
npx expo run:ios
npx expo run:android
```

首次从旧配置切换到无签名的 iOS Simulator 构建时，需要重新生成原生目录，清除其中已生成的 Associated Domains entitlement：

```bash
cd apps/mobile
unset EXPO_ENABLE_IOS_ASSOCIATED_DOMAINS
npx expo prebuild --platform ios --clean
npx expo run:ios --device "iPhone 17"
```

Web 只作为开发预览，Expo Router 使用 `single` 输出；M2 的发布验收目标是 iOS/Android 原生 bundle 与 Development Build。

最后两项分别需要 Xcode+iOS Simulator 与 Android SDK+Java/模拟器。EAS 云构建、签名、TestFlight/Play 分发需要外部账号或证书，未经单次授权不得执行。

macOS 上若 Android SDK 已由 Android Studio 安装、但 CLI 未发现工具链，可只对当前 shell 指定路径（示例使用 Homebrew JDK 17）：

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

不要把个人绝对路径写入仓库配置。首次原生构建可能由 Gradle 在已接受许可证的本地 SDK 中补装 compile SDK、NDK 和 CMake。

## 7. M0 人工 gate 隔离状态

| Gate         | M0 处理                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `M0-GATE-01` | 首区沿用已确认的澳大利亚；供应商、预算、托管 PostgreSQL/Redis 尚未决定，因此只实现本地栈和依赖端口，不写供应商适配器 |
| `M0-GATE-02` | 已存在 GitHub 仓库与远端；提交 CI 文件，但不在未授权情况下修改远端 Issue/Project、分支保护或 CI secrets/权限         |
| `M0-GATE-03` | 暂用 `Avalon（开发占位）` 与不可发布 `com.example.avalon.dev`；正式名称和平台 ID 决定后必须重建 Development Build    |

## 8. 故障排查

- `ready` 返回 503：先运行 `docker-compose ps`，再检查 `.env` URL 是否与 Compose 端口一致；响应本身不会暴露原因。
- pnpm 版本不匹配：使用 Corepack 激活根 `packageManager`，不要生成 npm/Yarn/Bun 锁文件。
- Expo 依赖漂移：在 `apps/mobile` 运行 `npx expo install --check`，不要手工猜测 React Native 原生依赖版本。
- Metro 报 `Unable to resolve "@avalon/protocol/mobile"`：确认 `packages/protocol/package.json` 的 `react-native`/`browser` 条件仍指向 `src/mobile.ts`，然后用 `npx expo start --dev-client --clear` 清理旧解析缓存。移动开发入口直接使用协议源码，不要求先生成被 Git 忽略的 `packages/protocol/dist`；Node/生产构建仍使用 `dist`。
- iOS/Android 构建后出现旧配置：删除未提交的原生目录并运行 `npx expo prebuild --clean`，不得手工修补 `ios/`、`android/`。
- iOS codesign 报 `resource fork, Finder information, or similar detritus not allowed`：确认仓库是否位于 iCloud/其他 File Provider 同步目录；从同步范围外的干净 checkout 构建。不要用 `xattr` 修改依赖或生成 Framework 来掩盖环境问题。
- `--localhost` 显示 `127.0.0.1`、但 Metro 只监听 `::1`：在当前 shell 设置 `NODE_OPTIONS=--dns-result-order=ipv4first` 后重启 Metro；iOS 模拟器继续使用 `127.0.0.1`，Android 模拟器继续配置 `adb reverse`。
- Docker 不提供 `docker compose` 子命令时，可使用独立的 `docker-compose`；根脚本已采用后者。

M0 的本地原生冒烟记录与无秘密截图见 [`verification/m0`](./verification/m0/README.md)。

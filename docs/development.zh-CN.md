# Avalon M0 本地开发、配置与验证

> 状态：M0 工程基线
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

`pnpm dev:deps` 使用供应商无关的本地 PostgreSQL/Redis。迁移由 `node-pg-migrate` 管理；M0 基线只建立独立运行时 schema，业务房间表属于 M2。

常用入口：

- Metro/Expo：终端显示的开发客户端或 Expo Go 地址；
- 服务存活：`http://127.0.0.1:3000/v1/health/live`；
- 服务就绪：`http://127.0.0.1:3000/v1/health/ready`；
- 停止依赖：`pnpm dev:deps:down`。

健康响应只返回 `ok/ready/not_ready`，不包含依赖地址、版本、房间或秘密配置。

## 3. 配置允许列表

应用只读取下列字段：

| 字段                                    | 作用                | 秘密             |
| --------------------------------------- | ------------------- | ---------------- |
| `NODE_ENV`、`HOST`、`PORT`、`LOG_LEVEL` | 进程与日志级别      | 否               |
| `DATABASE_URL`、`REDIS_URL`             | 本地/部署适配器连接 | 是，禁止日志     |
| `RATE_LIMIT_MAX`                        | M0 基础入口限流     | 否               |
| `RATE_LIMIT_HMAC_SECRET`                | 对限流来源键做 HMAC | 是，至少 32 字符 |

Compose 另外读取 `POSTGRES_DB/USER/PASSWORD`，仅用于本地容器。`.env` 不进入 Git；`.env.example` 只含不可复用占位值。服务端禁止请求体自动日志，并显式删减 Authorization、SessionToken、角色、知识、票与任务行动路径。

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
pnpm docs:check
pnpm secret:scan
```

`pnpm test:e2e:mobile` 运行 Maestro 的 M0 原生导航冒烟，需要已安装开发构建和 Maestro，并在执行前启动 `npx expo start --dev-client --localhost`；Android 模拟器另需执行 `adb reverse tcp:8081 tcp:8081`。`pnpm test:load` 针对已启动服务执行 50 请求的 M0 健康负载冒烟；它不是 `NFR-004` 的 1,000 房/10,000 连接发布验证。

## 6. Development Build 与 CNG

移动端提供 `development`、`preview`、`production` 三个 EAS profile，并安装 `expo-dev-client`。原生目录由 CNG 生成且不提交：

```bash
cd apps/mobile
npx expo start --go
npx expo prebuild --clean
npx expo run:ios
npx expo run:android
```

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
- iOS/Android 构建后出现旧配置：删除未提交的原生目录并运行 `npx expo prebuild --clean`，不得手工修补 `ios/`、`android/`。
- iOS codesign 报 `resource fork, Finder information, or similar detritus not allowed`：确认仓库是否位于 iCloud/其他 File Provider 同步目录；从同步范围外的干净 checkout 构建。不要用 `xattr` 修改依赖或生成 Framework 来掩盖环境问题。
- `--localhost` 显示 `127.0.0.1`、但 Metro 只监听 `::1`：在当前 shell 设置 `NODE_OPTIONS=--dns-result-order=ipv4first` 后重启 Metro；iOS 模拟器继续使用 `127.0.0.1`，Android 模拟器继续配置 `adb reverse`。
- Docker 不提供 `docker compose` 子命令时，可使用独立的 `docker-compose`；根脚本已采用后者。

M0 的本地原生冒烟记录与无秘密截图见 [`verification/m0`](./verification/m0/README.md)。

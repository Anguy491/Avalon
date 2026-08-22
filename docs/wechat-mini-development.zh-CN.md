# Avalon 微信小程序开发指南

> 状态：公开发布候选开发基线
>
> 架构决定：[ADR-011](./architecture/ADR-011-wechat-mini-program-client.md) · [ADR-012](./architecture/ADR-012-wechat-login-session-binding.md)

## 1. 已实现范围

`apps/wechat-mini` 覆盖建房、房间号/二维码加入、大厅管理与准备、身份揭示、组队、组队投票、任务行动、暂停/恢复、终止投票、刺杀、结果、固定主持音频和断线恢复。所有按钮由服务端 `availableActions` 决定，所有比分、角色知识、结算和胜负只使用服务端个性化投影。

发布 AppID 已固定为 `wx0240d55d0f3e4811`，并实现 `wx.login + SessionToken` 双因子会话绑定。项目不调用微信用户资料接口，也不包含公众号、支付、分享卡片、上传审核或发布操作。二维码只使用受控 HTTPS 加入链接。

## 2. 目录与边界

```text
apps/wechat-mini/          Taro 页面、微信平台适配、资源与构建配置
packages/client-core/      Expo/微信共用的无平台客户端策略
packages/protocol/         两端共用的协议 Schema、类型与运行时校验
apps/server/               唯一权威状态和逐玩家投影
```

小程序不得导入 `packages/game-engine`，不得从公开字段计算胜负或推断角色。`packages/client-core` 不依赖 Taro、Expo、Socket.IO、存储 SDK 或 UI 框架。

## 3. 本地运行

复制环境示例并填入开发服务：

```bash
cp apps/wechat-mini/.env.example apps/wechat-mini/.env.development
pnpm install --frozen-lockfile
pnpm dev:weapp
```

内部 Preview 示例：

```dotenv
TARO_APP_API_URL=https://preview.example.invalid
TARO_APP_JOIN_HOST=preview.example.invalid
TARO_APP_VERSION=0.1.0
```

然后用微信开发者工具导入 `apps/wechat-mini`；`project.config.json` 的 `miniprogramRoot` 已指向 `dist/`，合法域名检查与上传压缩保持开启。仅本机调试可在被 Git 忽略的 `project.private.config.json` 中关闭域名检查。CLI 自动化必须由对固定 AppID 有权限的已登录开发者执行。联调服务需允许 HTTPS 与 WSS；真机不能使用电脑的 `127.0.0.1`。

环境变量：

| 变量 | 用途 |
| --- | --- |
| `TARO_APP_API_URL` | HTTP API 根地址，不带末尾 `/` |
| `TARO_APP_JOIN_HOST` | 二维码加入链接允许的唯一 host |
| `TARO_APP_VERSION` | 上报到能力声明和无秘密音频错误遥测的版本 |

这些变量由 Taro 配置在构建时序列化为字符串常量；微信运行时不得直接读取 Node.js `process.env`。普通开发构建有本地默认值；发布构建拒绝缺失变量、非 HTTPS API、localhost、IP、`.invalid`、带路径的 API 或非法 join host。`postbuild:weapp` 会扫描构建产物，阻止未替换的 `TARO_APP_*` 引用进入开发者工具。

## 4. 平台实现

- HTTP：`Taro.request`，所有响应进入 `@avalon/protocol/mobile` 运行时校验；
- 实时：Socket.IO 只启用基于 `Taro.connectSocket`/`SocketTask` 的自定义 WebSocket transport；
- 会话：微信沙箱存储只保存 SessionToken 恢复记录和随机 installationId，恢复成功覆盖旧 token；`wx.login` 换取的 5 分钟微信身份令牌仅在内存保存；不保存 `RoomView`；
- 身份：创建、加入、恢复、读取投影与 Socket.IO 握手同时提交微信身份；身份过期时以同一幂等键刷新并最多重试一次，不支持无 SessionToken 找回；
- 生命周期：进入后台即停止音频、断开实时连接并遮挡内容；回前台先轮换 token、重新取得投影，再由玩家显式解除遮挡；
- 私密动作：不可逆动作二次确认，ACK 超时重试沿用同一 `commandId`，离线时不排队；
- 音频：Expo 与微信路径、字幕、版本和 SHA-256 均由同一 manifest 生成；只有 `delivery=LIVE` 且 `shouldPlayAudio=true` 时播放。后台/系统中断停止且不自动重播，资源失败只显示字幕；
- 二维码：只接受 `https://{TARO_APP_JOIN_HOST}/join/{roomCode}`，不自动打开任意链接；
- 包体：大厅和对局使用分包，脚本分别检查 2 MiB 分包门槛及 20 MiB 总门槛。

## 5. 验证

```bash
pnpm --filter @avalon/client-core test
pnpm --filter @avalon/wechat-mini test
pnpm --filter @avalon/wechat-mini typecheck
pnpm build:weapp
TARO_APP_API_URL=https://api.example.com \
TARO_APP_JOIN_HOST=join.example.com \
TARO_APP_VERSION=1.0.0 \
pnpm build:weapp:release
pnpm test:size:weapp
pnpm audio:verify
pnpm audit:prod:critical
pnpm test:contract
```

安装微信开发者工具后，将 `WECHAT_DEVTOOLS_CLI` 指向其 CLI，再执行：

```bash
WECHAT_DEVTOOLS_CLI=/path/to/cli pnpm test:e2e:weapp
```

该 E2E 是首页构建/渲染冒烟，不代替真机验收。固定 AppID 的开发者权限与合法 request/socket 域名就绪后，至少用 5 台设备或 1 台 UI 设备加头部测试客户端走通一局，并留存正常状态、后台遮罩、扫码拒绝、断网恢复和音频中断证据。

连接已批准的内部 Preview 后，可运行单模拟器完整流程；命令要求显式 HTTPS 地址，创建一名微信房主和四名头部 Bot，检查首页、创建、加入、扫码、大厅、身份遮挡、对局、刺杀和结果页，并把无私密身份的截图写入被 Git 忽略的 `apps/wechat-mini/test-results/preview/`：

```bash
WECHAT_DEVTOOLS_CLI=/path/to/cli \
WECHAT_PREVIEW_API_ORIGIN=https://preview.example.invalid \
pnpm test:e2e:weapp:preview
```

脚本先从 Node 和小程序运行时分别检查 Preview 健康状态。当前开发者工具的自动化会话可能忽略 `project.config.json` 中的 URL 校验设置；检测到 `url not in domain list` 时，脚本会暂停。此时在自动化窗口的“详情 → 本地设置”勾选“不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书”，再回到终端按回车。该设置只用于模拟器，不能替代真机合法域名配置。

Preview 服务必须接受协议能力 `platform: WECHAT_MINIPROGRAM`。若旧 Preview 尚未部署该协议，可仅为页面流程验收显式启用兼容垫片：

```bash
WECHAT_DEVTOOLS_CLI=/path/to/cli \
WECHAT_PREVIEW_API_ORIGIN=https://preview.example.invalid \
WECHAT_PREVIEW_LEGACY_PLATFORM_SHIM=1 \
pnpm test:e2e:weapp:preview
```

垫片只在 E2E 进程中把 REST 能力声明改写为 `IOS`，不改变产品构建，并会输出醒目标记；使用它得到的结果不证明已部署服务兼容微信协议。更新 Preview 服务后必须去掉该变量再跑一次。

当前固定的 `miniprogram-automator` 仍从 `Tool.getInfo.SDKVersion` 读取基础库版本，而新版开发者工具只返回工具 `version`。E2E 启动器在缺少该字段时改从小程序公开的系统信息读取 `SDKVersion`，继续执行最低版本校验，并把首页运行时异常作为测试失败处理。

## 6. 发布前人工门槛

1. 在微信公众平台为固定 AppID 配置 request/socket/业务合法域名，生产 `WECHAT_APP_ID` 必须一致；
2. 把 `WECHAT_APP_SECRET` 与微信身份 pepper 写入生产秘密存储；公开候选只允许服务端身份模式 `required`，并确认 legacy 活跃会话为零；
3. 按 [微信小程序隐私说明](./wechat-mini-privacy.zh-CN.md) 核对隐私保护指引，只声明微信登录和主动扫码所需用途，不申请麦克风、位置、通讯录或用户资料；
4. `build:weapp:release`、critical 审计、音频/包体门禁、完整微信 E2E 与隔离负载检查全部通过；
5. 在微信当前稳定版及至少一台低端 Android、一台 iPhone 上完成错账号、身份过期、后台预览、网络切换、扫码拒绝、最大字体、读屏和音频中断回归；
6. 经用户明确授权后才可上传代码、提交审核或公开发布。

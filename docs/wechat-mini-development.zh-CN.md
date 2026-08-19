# Avalon 微信小程序开发指南

> 状态：开发与内部测试基线
>
> 架构决定：[ADR-011](./architecture/ADR-011-wechat-mini-program-client.md)

## 1. 已实现范围

`apps/wechat-mini` 覆盖建房、房间号/二维码加入、大厅管理与准备、身份揭示、组队、组队投票、任务行动、暂停/恢复、终止投票、刺杀、结果、固定主持音频和断线恢复。所有按钮由服务端 `availableActions` 决定，所有比分、角色知识、结算和胜负只使用服务端个性化投影。

暂不包含真实小程序 AppID、`wx.login`、微信用户资料、公众号、支付、分享卡片、上传审核和发布。二维码使用受控 HTTPS 加入链接；在真实域名配置前可用房间号加入完成开发。

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

然后用微信开发者工具导入 `apps/wechat-mini`；`project.config.json` 的 `miniprogramRoot` 已指向 `dist/`。CLI 自动化必须使用当前登录开发者有权限的测试或正式 AppID；`touristappid` 只能用于不依赖 CLI 的有限手工开发。开发阶段关闭 URL 校验。联调服务需允许 HTTPS 与 WSS；真机不能使用电脑的 `127.0.0.1`，应填局域网可达的 TLS 地址或 Preview 域名。

环境变量：

| 变量 | 用途 |
| --- | --- |
| `TARO_APP_API_URL` | HTTP API 根地址，不带末尾 `/` |
| `TARO_APP_JOIN_HOST` | 二维码加入链接允许的唯一 host |
| `TARO_APP_VERSION` | 上报到能力声明和无秘密音频错误遥测的版本 |

这些变量由 Taro 配置在构建时序列化为字符串常量；微信运行时不得直接读取 Node.js `process.env`。未设置时分别使用 `http://127.0.0.1:3000`、`join.example.invalid` 和 `0.1.0`。`postbuild:weapp` 会扫描构建产物，阻止未替换的 `TARO_APP_*` 引用进入开发者工具。

## 4. 平台实现

- HTTP：`Taro.request`，所有响应进入 `@avalon/protocol/mobile` 运行时校验；
- 实时：Socket.IO 只启用基于 `Taro.connectSocket`/`SocketTask` 的自定义 WebSocket transport；
- 会话：微信沙箱存储只保存恢复记录和随机 installationId，恢复成功覆盖旧 token；不保存 `RoomView`；
- 生命周期：进入后台即停止音频、断开实时连接并遮挡内容；回前台先轮换 token、重新取得投影，再由玩家显式解除遮挡；
- 私密动作：不可逆动作二次确认，ACK 超时重试沿用同一 `commandId`，离线时不排队；
- 音频：构建将 `apps/mobile/assets/audio/zh-CN-v1` 复制到包内，只有 `delivery=LIVE` 且 `shouldPlayAudio=true` 时播放；
- 二维码：只接受 `https://{TARO_APP_JOIN_HOST}/join/{roomCode}`，不自动打开任意链接；
- 包体：大厅和对局使用分包，脚本分别检查 2 MiB 分包门槛及 20 MiB 总门槛。

## 5. 验证

```bash
pnpm --filter @avalon/client-core test
pnpm --filter @avalon/wechat-mini test
pnpm --filter @avalon/wechat-mini typecheck
pnpm build:weapp
pnpm test:size:weapp
pnpm test:contract
```

安装微信开发者工具后，将 `WECHAT_DEVTOOLS_CLI` 指向其 CLI，再执行：

```bash
WECHAT_DEVTOOLS_CLI=/path/to/cli pnpm test:e2e:weapp
```

该 E2E 是首页构建/渲染冒烟，不代替真机验收。真实 AppID 与合法 request/socket 域名就绪后，至少用 5 台设备或 1 台 UI 设备加头部测试客户端走通一局，并留存正常状态、后台遮罩、扫码拒绝、断网恢复和音频中断证据。

当前固定的 `miniprogram-automator` 仍从 `Tool.getInfo.SDKVersion` 读取基础库版本，而新版开发者工具只返回工具 `version`。E2E 启动器在缺少该字段时改从小程序公开的系统信息读取 `SDKVersion`，继续执行最低版本校验，并把首页运行时异常作为测试失败处理。

## 6. 发布前人工门槛

1. 注册并配置真实小程序 AppID、request 合法域名、socket 合法域名和业务域名；
2. 按 ADR-011 完成 SessionToken 本地存储专项评审，并决定 `wx.login` 绑定方案；
3. 核对隐私保护指引只声明主动扫码所需摄像头，不申请麦克风、位置、通讯录或用户资料；
4. 在微信当前稳定版及至少一台低端 Android、一台 iPhone 上完成包体、字体、前后台、网络切换和音频回归；
5. 经用户明确授权后才可上传代码、提交审核或公开发布。

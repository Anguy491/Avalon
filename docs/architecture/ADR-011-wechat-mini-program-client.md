# ADR-011：独立 Taro 微信小程序客户端与共享客户端核心

- 状态：已接受
- 日期：2026-08-19

## 背景

现有 MVP 已由 Expo 客户端完成 iOS/Android 安装包与真机验证。项目需要并行提供微信小程序客户端，但微信运行时没有浏览器原生 WebSocket、Keychain/Keystore、Expo Router 或 React Native 组件，不能直接把现有应用编译成小程序。同时，游戏裁决与秘密知识边界不能因增加客户端而复制或改变。

## 决策

- 新增 `apps/wechat-mini`，使用 Taro 4 + React 维护独立的小程序页面和平台适配层；不复用 React Native 视图组件；
- 新增 `packages/client-core`，只共享与平台无关的昵称/房间号规范化、幂等键、命令确认重试、投影版本收敛、路由决策和会话记录生命周期；该包不得包含游戏裁决；
- 小程序继续消费协议 v2 和服务端个性化 `RoomView`，HTTP 使用 `Taro.request`，Socket.IO 只启用包装 `Taro.SocketTask` 的 WebSocket transport；不新增小程序专用裁决接口；
- 页面按主包、`room` 分包和 `game` 分包组织；固定中文主持音频在构建时从现有语音包复制到小程序产物；
- 小程序只持久化恢复所需的 token、房间摘要、实时地址和随机 installationId，不持久化 `RoomView`、角色、知识、票或任务行动；前后台切换时断开连接、停止音频并显示中性遮罩；
- 发布 AppID 固定为 `wx0240d55d0f3e4811`；Taro 在构建时注入平台配置，产物不得依赖 Node.js `process.env`。合法域名、生产秘密、代码上传、审核和发布仍是人工门槛。

## 安全例外与发布门槛

微信小程序没有等同 iOS Keychain/Android Keystore 的应用可控硬件安全存储。小程序只把可恢复的 SessionToken 和无秘密房间摘要写入沙箱，不持久化微信身份令牌或 `RoomView`；SessionToken 维持 30 分钟滑动有效期并在恢复时原子轮换。

公开发布候选采用 [ADR-012](./ADR-012-wechat-login-session-binding.md) 的 `wx.login + SessionToken` 双因子绑定。微信身份只保护会话使用，不参与发牌、角色知识或胜负裁决。公开发布前仍须通过真机存储、后台预览、清理、错账号、抓包与旧 token 撤销测试。

## 结果

同一个服务端和协议可同时服务 Expo 与微信小程序，游戏规则和秘密投影仍只有一套权威实现。代价是两套 UI 需要分别维护，平台差异集中在 HTTP、WebSocket、存储、生命周期、扫码和音频适配器中；共享核心必须保持无平台依赖。

## 验证

- `pnpm --filter @avalon/client-core test` 验证共享幂等、版本和存储生命周期；
- `pnpm --filter @avalon/wechat-mini typecheck` 与 `pnpm build:weapp` 验证小程序编译；
- `pnpm test:contract` 验证 `WECHAT_MINIPROGRAM` 和 `wechat_miniprogram` 协议枚举；
- `pnpm test:size:weapp` 验证主包、分包和总包门槛；
- 配置 `WECHAT_DEVTOOLS_CLI` 后运行 `pnpm test:e2e:weapp`，并在固定 AppID 的开发者权限/合法域名具备后完成多机核心流程与隐私/音频人工证据。

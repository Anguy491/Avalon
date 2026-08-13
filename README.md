# Avalon

面向线下聚会的阿瓦隆移动端主持与对局应用。每名玩家使用自己的手机查看私密身份和提交动作，云端服务器负责权威裁决，房主设备播放固定中文主持音频。

仓库已完成 M0 工程基线：Expo SDK 56 移动端、Fastify/Socket.IO 服务端、纯游戏引擎边界、共享 TypeBox 协议包、确定性测试夹具、本地 PostgreSQL/Redis 与 CI 校验回路。Android 与 iOS Development Build、原生导航冒烟及 M0 自动化门禁均已通过。MVP 仍通过邀请制测试分发，不面向 App Store/Google Play 公开发布。

## 本地启动

要求 Node.js `24.19.0`、pnpm `11.16.0`、Docker。然后执行：

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm dev:deps
pnpm --filter @avalon/server db:migrate
pnpm dev
```

移动端 Metro 默认使用 Expo Development Build；也可先执行 `pnpm --filter @avalon/mobile start --go` 走 Expo Go 基础导航回路。服务端存活与就绪端点分别是 `GET /v1/health/live`、`GET /v1/health/ready`。

完整配置、验证命令和故障排查见 [M0 开发指南](./docs/development.zh-CN.md)。

## 文档入口

- [完整文档索引](./docs/README.md)
- [游戏规则](./docs/game-rules.zh-CN.md)
- [服务端状态机](./docs/server-state-machine.zh-CN.md)
- [移动端 FR/NFR](./docs/mobile-fr-nfr.zh-CN.md)
- [架构与 ADR](./docs/architecture/README.md)
- [API/实时协议](./docs/api-contract.zh-CN.md)
- [UX 规范](./docs/ux-spec.zh-CN.md)
- [测试策略](./docs/test-strategy.zh-CN.md)
- [安全威胁模型](./docs/Avalon-threat-model.md)
- [实施路线图](./docs/roadmap.zh-CN.md)

自动化代理和贡献者开始工作前必须阅读 [AGENTS.md](./AGENTS.md)。

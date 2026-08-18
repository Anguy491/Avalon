# ADR-010：DigitalOcean 单 Droplet Preview 部署

- 状态：已接受（仅内部 Preview）
- 日期：2026-08-18

## 背景

用户已有位于新加坡的 DigitalOcean Droplet、Docker 环境和 Cloudflare 托管域名，希望先为少量获授权设备提供内部安装测试。该环境不是 ADR-002 所定义的生产拓扑：只有一个主机，不使用托管 PostgreSQL/Redis、自动备份、独立 Volume 或高可用应用实例。

## 决策

- `avalon.anguy.dev` 只通过远程管理的 Cloudflare Tunnel 暴露 HTTPS/WSS；Droplet 不开放 Avalon 入站端口；
- CI 把服务端和一次性前向迁移器分别发布到 GHCR，并保留 SBOM/provenance；Droplet 仅拉取 `@sha256:` 引用，不 clone 仓库、不在环境内构建；
- Caddy 位于 Tunnel 与服务端之间，只接受隔离 Docker 网络流量，并用 Cloudflare 的 `CF-Connecting-IP` 覆盖 `X-Forwarded-For`；服务端只信任 Caddy 固定私网地址；
- PostgreSQL、Redis、服务端和迁移器不映射主机端口。迁移成功后服务端才启动；数据库 schema 回滚不自动执行；
- 内部 Preview 的 secrets 存于 Droplet root-only `.env`，权限为 `0600`。不写入仓库、镜像、Compose 命令、日志或 EAS plain 环境变量；
- 按用户明确选择，Preview 数据使用本机 Docker named volume，不启用 DigitalOcean 自动备份、独立 Volume 或快照；暂态房间数据不得另行进入长期备份。

## 适用边界

该拓扑只用于邀请测试前的内部 Preview 和少量已批准测试者，不构成 M8 外部邀请就绪或生产可用性证明。单机故障可能同时中断应用、PostgreSQL、Redis 和 Tunnel，磁盘故障可能造成数据永久丢失。

如果进入外部邀请或生产阶段，必须重新评估至少两应用实例、托管数据库/Redis、秘密管理、备份残余、告警和供应商数据区域，并回到 ADR-002 的可靠性目标。

## 结果

部署不会干扰 Droplet 上已有服务，不需要新增公网端口；服务镜像可按 CI digest 审计和回滚。代价是无主机级高可用、无数据库备份，并接受 root-only 文件相对于供应商 secret manager 的内部 Preview 折中。

## 验证

- `pnpm deploy:preview:check` 断言 Compose 无端口映射、私网边界、迁移门槛和可信代理地址；
- 未登录客户端能按 digest 拉取两个公开 GHCR package；
- Cloudflare Tunnel 只把 `avalon.anguy.dev` 路由到 Compose 内 `proxy:8080`；
- `/v2/health/live` 与 `/v2/health/ready` 经公网 TLS 返回成功，直接访问 Droplet Avalon 端口失败；
- 重启 Docker 和 Droplet 后服务恢复，PostgreSQL/Redis named volume 保持，旧 digest 可按前向兼容规则回滚。

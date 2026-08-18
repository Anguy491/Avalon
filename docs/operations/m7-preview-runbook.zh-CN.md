# M7 Preview 选择与操作手册

## 1. 共同门槛

1. 只从 CI 生成的同一 OCI digest 晋级；保留 OCI provenance 与 SBOM，禁止在环境内重建。
2. API/Realtime 仅经 TLS 1.2+ 入口公开；PostgreSQL、Redis 和任务实例仅在私网。源服务安全组只允许入口和运维控制面。
3. 入口必须覆盖 `X-Forwarded-For`，不得追加客户端值；`TRUSTED_PROXY_CIDRS` 只列入口子网。
4. secrets 使用供应商 secret manager 和短期 OIDC；不得进入 EAS plain 环境变量、镜像、日志或仓库。
5. 暂态房间表不进入长期备份。先确认自动备份、PITR/WAL、只读副本和供应商日志的物理残余上限，再允许邀请测试。
6. OTLP Collector 只接收固定指标，不启用自动 HTTP instrumentation。导入 `ops/alerts/avalon-m7.rules.yml` 并验证通知路由。
7. 部署前运行 `pnpm preview:check`；任何红项都保持 `PREVIEW_READY_NOT_DEPLOYED`。

## 2. 推荐：AWS Sydney (`ap-southeast-2`)

- ECS/Fargate 运行同一服务镜像；ALB 提供 HTTPS/WSS 与健康检查，原生支持 WebSocket。
- RDS PostgreSQL 与 ElastiCache Redis 位于私有子网；安全组只允许任务 ENI。
- CloudWatch/ADOT Collector 接收固定指标；应用日志保留最短必要周期且执行 canary 扫描。
- 按“RDS 可用连接 − 运维/迁移保留量，再除以最大 ECS task 数”设置 `DATABASE_POOL_MAX`。
- ALB idle timeout 必须高于心跳间隔；滚动更新先让 readiness 失败，再观察 30 秒 drain。

参考：[AWS ALB listeners/WebSocket](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-listeners.html)。

## 3. 备选：GCP Sydney (`australia-southeast1`)

- Cloud Run 运行同一 OCI digest；外部 HTTPS Load Balancer/Cloud Run 提供 HTTPS/WSS。
- Cloud SQL PostgreSQL 与 Memorystore Redis 使用私网连接；实例服务账号只读所需 secrets。
- Cloud Monitoring/Managed Collector 接收 OTLP 固定指标。
- Cloud Run WebSocket 请求最长 60 分钟；客户端必须依靠既有 token 恢复与 2 秒心跳安全重连，不得假设连接永久存在。
- 按“Cloud SQL 可用连接 − 保留量，再除以最大 Cloud Run 实例数”设置数据库池。

参考：[GCP Cloud Run WebSocket](https://docs.cloud.google.com/run/docs/triggering/websockets)。

## 4. EAS Internal Distribution（人工）

1. 创建真实 EAS project，使用已确定的应用名“曼波阿瓦隆”、slug `anguy-avalon`、scheme `anguyavalon`、iOS Bundle ID/Android Application ID `dev.anguy.avalon`，并把 project UUID 和已验证 App Links 写入 Preview 环境。
2. Android 使用 internal APK；iOS 使用 ad hoc，并在构建前确认全部测试设备 UDID。
3. 签名凭证和 `SENTRY_AUTH_TOKEN` 只由获授权人员在 EAS sensitive 环境录入。构建前必须从 `apps/mobile` 运行 `eas env:exec preview 'SENTRY_URL=https://sentry.io pnpm exec sentry-cli info'`，通过全局鉴权端点确认 token 能访问目标组织；401/403/404 均停止构建，实际上传仍使用 Preview 中的 DE 区 `SENTRY_URL`。source map 上传优先使用具有 `org:ci` 的组织 token；`sentry-cli` 管理 release 时还需要 `org:read`。
4. 关闭未认证构建链接；只向批准名单发送安装入口。
5. 安装后分别验证 HTTPS/WSS、恢复轮换、后台遮罩、音频与 Sentry canary；失败立即撤销构建链接。

参考：[EAS internal distribution](https://docs.expo.dev/build/internal-distribution/)、[EAS 环境变量](https://docs.expo.dev/eas/environment-variables/)。

## 5. 内部 Preview：DigitalOcean Singapore + Cloudflare Tunnel

该路径按 [ADR-010](../architecture/ADR-010-digitalocean-preview-deployment.md) 只用于邀请测试前的内部 Preview，不替代 AWS/GCP 生产候选拓扑，也不构成高可用或备份证明。

1. `main` 校验成功后，CI 分别把 `runtime` 与 `migrator` target 推送到 GHCR，并上传包含两个 `@sha256:` 引用的 `avalon-preview-images-<commit>` artifact。首次发布后把两个 Container package 设为 Public，并匿名验证 digest 拉取；
2. Droplet 只复制 [`deploy/preview`](../../deploy/preview/README.md) 声明文件，不 clone 仓库、不安装 Node/pnpm、不运行 `docker build`；
3. 远程管理的 `avalon-preview` Tunnel 把 `avalon.anguy.dev` 路由到 Compose 内 `http://proxy:8080`。应用、PostgreSQL、Redis 和 Caddy 均不映射主机端口；
4. secrets 只写入 `/opt/avalon-preview/.env`，所有者为 root、权限 `0600`。这是内部 Preview 的显式例外，进入外部邀请前仍须迁移到符合共同门槛的秘密管理方案；
5. 按已批准选择，数据位于本机 Docker named volume，不启用 DigitalOcean 自动备份、独立 Volume 或快照。主机/磁盘故障可能永久丢失数据，且该环境不得被描述为生产；
6. 更新只替换 CI artifact 给出的两个 digest。迁移器成功退出后服务端才启动；应用回滚不执行 down migration。

## 6. 滚动、回滚与销毁

- 滚动：先检查 `/v2/health/ready`，按一台实例替换，确认旧实例发出维护事件并排空，再继续。
- 应用回滚：只回退到与当前数据库列前向兼容的上一 OCI digest；不得自动 down migration。
- 数据恢复：仅按故障演练手册在隔离数据库验证；真实恢复需明确事件负责人。
- 销毁顺序：撤销分发链接/DSN → 导出聚合容量证据 → 删除服务和入口 → 删除 Redis/数据库与快照 → 等待并记录供应商残余期限 → 撤销 OIDC/secrets/DNS。

## 7. 预算模板

分别记录最小/目标/峰值的任务实例小时、ALB/Cloud Run 请求与出站、PostgreSQL 规格/存储/PITR、Redis 规格、OTLP/日志量、EAS 构建与 Sentry 事件量。预算只能用于选择，不构成购买授权。

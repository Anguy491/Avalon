# DigitalOcean Preview 部署包

此目录只包含 Droplet 运行 Avalon 所需的声明文件。Droplet 不 clone 仓库、不构建镜像，也不公开应用、PostgreSQL 或 Redis 端口。

## 拓扑与固定约束

- GitHub Actions 分别发布 `avalon-server` 与一次性 `avalon-migrator`，部署只使用 CI artifact 中的 `@sha256:` 引用。
- `cloudflared` 通过仅出站 Tunnel 连接 Cloudflare；远程 ingress 将 `avalon.anguy.dev` 转发到 Compose 内的 `http://proxy:8080`。
- Caddy 只接受 `cloudflared` 所在 Docker 网络的流量，并以 Cloudflare 写入的 `CF-Connecting-IP` 覆盖 `X-Forwarded-For`；服务端只信任 Caddy 的固定私网地址 `172.31.77.254/32`。
- PostgreSQL、Redis、迁移器和服务端只接入 `internal` 私网。Compose 没有 `ports` 映射。
- Preview 使用 Droplet 本地 named volume；按已批准选择，不启用 DigitalOcean 自动备份、独立 Volume 或快照。暂态房间数据不得另行纳入长期备份。

## 首次部署

1. 从成功的 `main` 工作流下载 `avalon-preview-images-<commit>`，复制其中两条镜像引用。
2. 在 Droplet 创建 `/opt/avalon-preview`，复制本目录的 `compose.yaml`、`Caddyfile`、`well-known/` 和 `.env.example`；将示例复制为 `.env`。
3. 使用 URL-safe 随机值填写数据库密码和三个独立应用秘密；把远程管理 Tunnel token 写入 `.env`，然后执行 `chmod 600 .env`。
4. 在本地或 CI 执行 `pnpm deploy:preview:check`。在 Droplet 执行：

   ```bash
   docker compose --env-file .env config --quiet
   docker compose --env-file .env pull
   docker compose --env-file .env up -d
   docker compose --env-file .env ps
   docker compose --env-file .env logs --no-color migrator
   ```

5. 等待服务健康后验证：

   ```bash
   curl --fail --silent --show-error https://avalon.anguy.dev/v2/health/live
   curl --fail --silent --show-error https://avalon.anguy.dev/v2/health/ready
   ```

首次 GHCR 发布后，仓库所有者必须把两个 Container package 的 visibility 调整为 `Public`，并用未登录环境验证按 digest 匿名拉取。私有仓库不会自动让关联 package 公开。

确定 Apple Team ID 和 EAS Android 签名证书 SHA-256 后，分别把两个 `.example` 模板复制为无 `.example` 后缀的正式文件并替换占位值。Caddy 会在无重定向的精确路径提供它们；填写前保持文件不存在，使验证 fail-closed：

```text
/.well-known/apple-app-site-association
/.well-known/assetlinks.json
```

## 更新与回滚

更新时只替换 CI artifact 给出的两个 digest，先执行 `pull`，再执行 `up -d`。迁移器成功退出后服务端才会启动。回滚只替换为与当前数据库 schema 前向兼容的上一服务 digest；不得对共享 Preview 数据库自动执行 down migration。

销毁容器时不要附加 `--volumes`。删除 `postgres-data` 或 `redis-data` 属于破坏性操作，必须另行确认。

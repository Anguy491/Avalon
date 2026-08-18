# M7 安全、容量与 Preview 就绪追踪

## 1. 状态与范围

目标状态为 `PREVIEW_READY_NOT_DEPLOYED`。本轮不创建 AWS/GCP 资源，不执行 EAS 签名/分发、DNS/TLS 变更或真实 Sentry 出站验证。

`M7-002`、`NFR-018`–`NFR-020`、`AC-014` 延期但不删除；这些项目以及支持系统真机矩阵继续阻塞 M8 外部邀请就绪声明。根级 AppState 遮罩属于 `FR-020`/`TM-010` 的秘密保护，不代表无障碍完成。

## 2. Issue 与证据映射

| Issue | 实现 | 追踪 | 自动证据 | 当前状态 |
| --- | --- | --- | --- | --- |
| `M6-003` | `zh-CN-v1` 清单、生成模块、字幕降级、`expo-audio` 播放器、音量/静音/重播入口和哈希检查 | `FR-016`、`FR-035`–`FR-039`、`NFR-015`、`NFR-021` | `generate-audio-pack.mjs`、移动单元测试 | 字幕及哈希已就绪；正式音频、文件哈希和权利审核待素材，Preview fail-closed |
| `M7-001` | 凭证代际、跨实例撤销、投影/ACK 代际检查、分层配额、可信代理、有限遥测维度 | `TM-001`–`TM-008`、`NFR-012`–`NFR-017`、`AC-013`、`AC-015` | `test:security`、协议/集成测试 | 自动安全、契约与集成验证通过；真实入口覆盖头仍属部署门槛 |
| `M7-002` | 无障碍 | `NFR-018`–`NFR-020`、`AC-014` | 无 | 延期 |
| `M7-003` | Sentry 严格允许列表、根隐私遮罩、无自动 HTTP 采集的 OpenTelemetry 指标、告警模板 | `NFR-008`、`NFR-014`、`NFR-023`、`FR-020` | Sentry canary、隐私状态、logger/metrics 审查 | DSN、DE 组织和真实出站代理为人工门槛 |
| `M7-004` | 20 房 smoke 保留；worker-thread 1,000 房/10,000 Socket/30 分钟发布负载 | `NFR-002`–`NFR-004` | `test:load`、`test:load:release` | 完整场景须在隔离容量环境执行 |
| `M7-005` | 终局相同 eventId 重投、30 秒在途排空、前向迁移和恢复演练手册 | `NFR-006`–`NFR-007`、`NFR-016` | 提交前/发布后故障、连接中断、Redis 清空、Outbox 重放、30 秒投票/60 分钟暂停时钟边界和 `pg_dump/restore` 集成测试 | 容器内恢复/RPO 0 已通过；供应商 WAL/备份残余为真实部署人工项 |
| `M7-006` | Preview validator、AWS/GCP/EAS 手册、DigitalOcean 内部 Preview 声明、GHCR digest、OCI SBOM/provenance | `NFR-012`、`TM-008`、发布门槛 | `preview:check` 正反夹具、`deploy:preview:check`、CI OCI/GHCR artifact | Tunnel/DNS 已配置；应用仍为 `PREVIEW_READY_NOT_DEPLOYED` |

## 3. 安全扫描闭环

2026-08-14 标准扫描共 9 项（3 high、5 medium、1 low）。本增量分别在以下边界闭环：

1. 终局 ACK：事件级配额，并先条件更新收据，只有新 ACK 才锁房间。
2. 音频遥测：协议仅允许 `zh-CN-v1`，每会话 6/min，固定 hash field 且 TTL 10 分钟。
3. 未认证握手：可信 IP 30/min、100 个待认证、3 秒超时、实例/全局/会话连接预算。
4. 可信代理：Production 缺少 CIDR 时启动失败；只有可信入口的单值覆盖头可成为客户端 IP。
5. 旧 Socket：数据库 `credential_generation`、Redis 撤销、投影/命令/ACK/心跳代际校验。
6. installationId 绕限流：组合桶之外独立 IP 30/min 和全局 600/min。
7. Preview 占位：`preview:check` 与非 Development app config fail-closed。
8. 后台快照：根布局中性遮罩覆盖全部路由。
9. 基础镜像：Node tag+OCI index digest；CI 生成 SBOM/provenance。

扫描原报告位于临时扫描目录，不复制其中可能失效的绝对路径到发布材料。扫描记录总 token 用量为 804,399。

## 4. 负载与告警门槛

- `test:load`：20 房快速完整协议 smoke。
- `test:load:release`：严格要求 1,000 房、10,000 连接、至少 30 分钟稳态；默认 20 分钟 ramp。入口配额必须在隔离压测拓扑中按来源分片或临时提高，不能在共享 Preview 绕过配额。
- 通过：创建/加入 p95 ≤2 秒，命令 ACK 与最终投影 p95 ≤1 秒，错误率 <1%，无错房、秘密字段、版本回退或重复裁决；同时审查 p99、RSS 和事件循环 p99 是否持续恶化。
- 告警模板在 `ops/alerts/avalon-m7.rules.yml`；具体后端的 p95 recording rule 由 Preview 运维手册创建并验证。

## 5. 未执行人工门槛

- 正式音频文件、逐字字幕哈希、权利审核、iOS/Android 首播/中断/重播/损坏证据；
- AWS 或 GCP 账号、网络、数据库、Redis、域名和 TLS；
- EAS project、iOS UDID/签名、Android APK 分发和未认证链接关闭；
- Sentry DE 组织、DSN、source map token 和 canary 出站代理；
- 1,000 房/30 分钟发布负载、迁移新旧代码滚动、供应商级灾备和支持系统真机矩阵；
- 延期的无障碍验收。

任何上述项目未完成时，不得把 M7 写成“已部署”“Preview 已通过”或“可邀请外部用户”。

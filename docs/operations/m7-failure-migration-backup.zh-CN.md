# M7 故障、迁移、备份与回滚演练

## 自动故障矩阵

| 场景 | 注入点 | 必须断言 |
| --- | --- | --- |
| 事务提交前杀进程 | 最后提交、processed command/Outbox 写入前 | 命令未确认；重试最多产生一次规则效果 |
| 事务提交后杀进程 | commit 完成、ACK/发布前 | 已确认恢复点 RPO 0；同 commandId 返回原结果 |
| Redis 重启/清空 | 心跳、投影发布、Outbox 重投 | PostgreSQL 权威状态不变；客户端恢复，不错房 |
| PostgreSQL/Redis 短断 | 强制终止已有客户端连接 | readiness 暂时失败；连接可用后 5 秒内重建池/连接并继续 |
| Outbox 重复/延迟 | claim 后崩溃、发布后重入 | 同 eventId；版本单调；裁决不重复 |
| 双实例 token 轮换 | 两实例并发 resume | 代际单调且同一旧 token 只轮换一次；旧 Socket 收到 `SESSION_REPLACED` |
| 30 秒投票与 60 分钟暂停边界/时钟偏移 | 注入服务器 Clock port | 未获继续多数或硬上限到期只产生 `ABORTED`，不判阵营胜负 |

## 前向迁移与应用回滚

1. 只在隔离数据库复制固定测试房间。
2. 执行 `db:migrate`，确认旧实例仍能读写旧字段，新字段有安全默认值。
3. 新旧实例滚动并执行协议/幂等/投影测试。
4. 把应用回滚到上一 OCI digest；数据库保持新 schema，不运行 down。
5. 仅在已销毁应用流量的隔离数据库执行 `db:rollback`，验证 down 本身可用。

破坏性或非前向兼容迁移必须另建 ADR 和人工决策，不得进入普通滚动发布。

## `pg_dump` / restore

1. 使用专用隔离数据库与固定测试凭证；命令输出不得包含 token/角色载荷。
2. 创建固定大厅、投票、任务、暂停房间并确认命令版本。
3. 使用与目标 PostgreSQL 大版本一致的 `pg_dump --format=custom`。
4. 恢复到全新数据库，运行迁移和 `/v1/health/ready`；从恢复开始到可恢复会话须少于 5 秒。
5. 重放已确认 commandId，断言 RPO 0、没有重复规则效果。
6. 推进终局并等待 ACK/60 秒，抽检 rooms、players、sessions、processed_commands、terminal_receipts、outbox 全部清除。
7. 删除 dump 与隔离数据库。真实供应商备份/WAL 残余期限记录在 Preview 人工清单。

仓库集成测试在一次性 PostgreSQL 容器内执行真实 custom-format `pg_dump/pg_restore`，验证恢复少于 5 秒、已确认 create command 幂等重放（RPO 0），并抽检 rooms、sessions、processed_commands 与 Outbox。供应商托管备份和 WAL 演练不由本地测试替代。

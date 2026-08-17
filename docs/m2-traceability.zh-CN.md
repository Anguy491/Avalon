# M2 会话与房间追踪证据

> 日期：2026-08-13（Australia/Sydney）
>
> 范围：`M2-001`–`M2-006`；不包含 M3 的准备、座次编辑、移除、关闭或开局裁决

## 纵向追踪

| Issue | 上游规则/需求 | 实现边界 | 自动化证据 |
| --- | --- | --- | --- |
| `M2-001` | `ADR-003`、`NFR-007`、`NFR-016` | `000002_m2_rooms_sessions_outbox.cjs` 建立房间、玩家、会话、去重、Outbox 与终局回执；外键级联清除 | `M2-001` migration up/down、约束、索引、级联、无明文 token 列集成测试 |
| `M2-002` | `SM-001`–`SM-002`、`FR-001`–`FR-005`、`NFR-013` | 严格 Schema 后创建/加入；行锁串行最后席位；规范请求摘要区分幂等重放/冲突；HMAC 限流键 | `SM-001/SM-002` 创建加入矩阵；双实例并发末席；`AC-013` Redis TTL/键/错误码检查 |
| `M2-003` | `SM-003`、`FR-006`、`NFR-010`、`TM-002` | 256 位 token、仅摘要入库、事务轮换/撤销；AES-GCM 幂等响应；SecureStore 与崩溃恢复键 | 服务端轮换/并发/旧 token 测试；移动端 SecureStore、写入前崩溃和幂等键单测；secret scan |
| `M2-004` | API 第 4 节、`ADR-004`、`SM-011`–`SM-012`、`TM-001`、`TM-003` | `/game-v2` Socket 鉴权；actor 只取 `SessionContext`；命令、响应与 Outbox 同事务；逐会话 `RoomView` | ack 重放/冲突/过期版本/跨房；两实例个性化 LIVE/RESYNC、伪造 actor 与 Redis 丢失集成测试 |
| `M2-005` | `UX-001`–`UX-005`、`FR-001`–`FR-006`、`FR-042`、`FR-046`、`AC-013` | Expo Router 首页、创建、单输入框加入、受控深链/扫码、权限解释与手输降级、大厅/公开 QR；Query cache 只存 `RoomView` | 房间号/QR allowlist、昵称 grapheme、版本回退单测；Maestro 正常与错误/拒权流程；模拟器截图 |
| `M2-006` | `AC-009`、`NFR-006`–`NFR-007`、`TM-003`–`TM-004` | PostgreSQL 权威状态，Redis 非权威；Outbox 租约与至少一次发布；安全 allowlist 日志 | 提交前、发布前/后故障注入；双 worker 去重领取；双实例重连；集成套件和 M2 create/join 负载冒烟 |

## 秘密与权限边界

| 边界 | 断言 | 证据 |
| --- | --- | --- |
| 数据库 | token 只有 HMAC 摘要；幂等 bootstrap 是 AES-GCM 密文；终局/过期删除沿房间级联 | migration schema 检查、轮换/清理集成测试 |
| 日志/缓存 | 禁止 request body 与 Authorization 自动日志；IP/安装 ID 只形成 HMAC Redis 键；Redis 广播已个性化 | logger serializer/redaction、限流键检查、双实例差分投影测试、`secret:scan` |
| 服务端权限 | handler/Socket payload 不接受 actor；token 解析得到唯一 room/player/session | 伪造 actor、跨房 command 与无效 token 测试 |
| 移动端 | token 不进 URL、Query、表单错误、AsyncStorage；他人私密投影不持久化；二维码只有公开 URL | SecureStore 单测、静态依赖/secret scan、QR allowlist 与视觉证据 |

## 退出门槛映射

1. 两客户端玩家列表：HTTP 创建/加入响应与两实例 Socket 完整投影集成测试；iOS 原生大厅流程提供设备侧证据。
2. token 无明文副本：迁移结构、数据库抽检、日志白名单、SecureStore 单测与 secret scan。
3. 幂等/并发/轮换：同键重放、冲突键、并发最后席位、并发恢复与旧 token 失效全部由 PostgreSQL/Redis 集成套件覆盖。
4. 崩溃恢复：提交前回滚、提交后 ack 重试、发布前重试、发布后重复投递和双 worker 领取均有故障注入。
5. 安全替代流程：非法 QR 不导航，错误房间模糊，拒绝相机后可返回手输；单元、Maestro 和截图三层证据。

`NFR-004` 的 1,000 房/10,000 连接、30 分钟发布容量属于 M7；M2 只运行有限 create/join 压力回归验证持久化路径与 `NFR-002` 的 2 秒 p95 门槛，不把冒烟结果表述为发布容量证明。

# ADR-008：M2 会话轮换、幂等响应与逐会话投递

- 状态：已接受
- 日期：2026-08-13

## 背景

M2 的创建、加入和恢复发生在未认证或仅持有一次性 bearer token 的边界。移动进程可能在收到响应前后崩溃，两个服务实例也可能同时处理同一个幂等键、会话恢复或 Outbox。实现必须同时满足 `SM-001`–`SM-003`、`NFR-007`、`NFR-010`、`NFR-013` 与 `TM-001`–`TM-005`，且不能把 token、原始 IP、安装标识或包含秘密的共享消息变成新的持久副本。

## 决策

### 会话与恢复

- SessionToken 使用注入的 CSPRNG 生成 256 位不透明值，服务端只保存带独立 pepper 的 HMAC 摘要；
- 恢复在房间事务中锁定会话，撤销旧摘要、写入新摘要并提交幂等响应；同一个恢复键可安全重放，同一个旧 token 的不同并发键只有一个成功；
- 客户端 token 只存在于内存引用和 Expo SecureStore，使用 `WHEN_UNLOCKED_THIS_DEVICE_ONLY`；为处理“服务端已轮换、客户端写入前崩溃”，SecureStore 另保存待完成恢复的幂等键；
- 安装标识是首次启动生成的随机 UUID，只用于 `NFR-013` 的临时限流，不是玩家身份、硬件 ID 或广告 ID。

### 幂等与数据最小化

- 创建、加入、恢复和实时命令都以稳定 UUID 幂等键与规范化请求摘要区分“相同重试”和“同键不同载荷”；
- `processed_commands` 保存响应的 AES-256-GCM 密文，不保存可读取的 SessionToken；加密密钥与 token pepper 分离；
- 冲突返回稳定错误码，不回显请求载荷、token、昵称或内部主键；客户端仅在相同载荷重试时复用键，成功或载荷改变后换键。

### 投递与多实例

- 命令更新、幂等结果和 Outbox 在同一个 PostgreSQL 事务提交，ack 只在提交后返回；
- worker 使用 `FOR UPDATE SKIP LOCKED` 与短租约领取记录。发布失败或发布后进程崩溃都允许再次发布同一 `eventId/stateVersion`；
- worker 在发布前按每个有效会话生成完整 `RoomView`，Redis 只传递已经个性化且带目标 session ID 的消息。Gateway 只向对应连接发送，禁止发布领域事件或含所有玩家私密数据的共享模型；
- 客户端按 `stateVersion` 丢弃重复/回退投影；连接、回前台或版本缺口使用完整 `RESYNC`，不重放动作或音频副作用。

### 枚举限制

创建/加入按 `HMAC(IP + 随机安装标识)` 使用 Redis 计数，TTL 固定在 10 分钟以内。原始来源值不写日志、数据库或 Redis 键。房间号不存在、格式错误与不可加入均使用稳定的模糊错误；二维码只包含受控 HTTPS host 与 `/join/{roomCode}`。

## 结果

移动端可以跨崩溃恢复 token 轮换；多实例下相同命令最多产生一次状态效果；Outbox 至少一次投递最终由完整版本化投影收敛。代价是需要独立的密钥轮换策略、加密幂等数据清理、客户端安全存储恢复状态，以及“重复投递是正常情况”的明确测试。

Web 导出仅用于开发预览，采用 Expo Router `single` 输出，避免共享 TypeBox CommonJS barrel 在 Node 静态渲染阶段执行；iOS/Android 原生 bundle 仍是 M2 验收目标。任何 Preview/Production 构建必须显式提供 HTTPS API 与 WSS 实时地址，占位 `localhost.invalid` 不得发布。

## 未采用方案

- 把 token 明文放进幂等响应：数据库泄漏会直接变成会话接管；
- token family 允许旧 token 宽限：并发盗用与合法恢复无法明确裁决；
- Redis 保存权威房间或未投影领域事件：Redis 丢失会破坏恢复，且共享广播扩大秘密泄漏面；
- 客户端 AsyncStorage、URL 参数或 Query cache 保存 token：不满足平台安全存储与日志/链接边界；
- 扫码后自动打开任意 URL：会把公开二维码入口变成钓鱼跳转。

## 验证

- 数据库迁移 up/down、约束、级联和“无明文 token 列”检查；
- 创建/加入相同与冲突幂等键、并发最后席位、房间号熵、Unicode 与枚举限流测试；
- 恢复轮换、旧 token 失效、并发恢复与客户端写入前崩溃测试；
- 两实例 Socket 鉴权、伪造 actor、逐连接差分投影、Redis 丢失、Outbox 多 worker/崩溃点测试；
- iOS Development Build 的创建、手输错误、相机拒绝降级和大厅视觉证据。

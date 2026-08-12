# ADR-004：Socket.IO 命令确认与完整个性化投影

- 状态：已接受
- 日期：2026-08-13

## 背景

移动网络会断开、切换和重连。Socket.IO 保证同一连接内消息顺序，但默认消息到达为“至多一次”；内置连接恢复也可能失败。因此不能依赖传输层保证提交不丢失或客户端永远收到每个增量事件。

## 决策

- 采用 Socket.IO 4.x 稳定协议族，版本由锁文件固定；
- 客户端用 `command.submit` 发送状态机命令，服务端用 ack/`command.result` 返回相同 `commandId` 的接受或拒绝结果；
- 应用级 `commandId + expectedStateVersion + processedCommands` 提供幂等和并发控制；
- 服务端在每个已提交版本后发送完整、逐玩家个性化的 `room.view`，不要求客户端应用领域事件增量；
- 客户端只接受大于本地版本的投影；发现版本缺口、恢复失败或 Schema 不兼容时调用读取当前投影接口；
- 内部 `DomainEvent` 不直接暴露到 Socket.IO，必须经过投影器；
- Socket.IO connection state recovery 可用于短断线优化，但 `skipMiddlewares=false`，任何失败都回退到应用级重同步；
- 生产多实例使用支持 packet recovery 的 adapter 或直接重发最新投影；无论 adapter 能力如何，正确性不得依赖 packet replay。

`room.view.delivery` 取 `LIVE` 或 `RESYNC`。只有房主收到的 `LIVE` 投影可携带 `shouldPlayAudio=true`；恢复、读取和重复旧版本不得自动播放。

## 结果

完整投影对每房最多 10 人的负载足够小，显著降低客户端乱序、事件缺失和权限过滤错误。服务端拥有唯一投影逻辑，便于角色知识矩阵测试。

代价是每次变化会发送重复公开字段。实现必须设置投影大小预算、压缩和负载测试，防止历史无限膨胀；完整公开历史可按固定五轮上限保持有界。

## 未采用方案

- 原始 WebSocket：需要自行实现 ack、重连、房间广播和传输兼容；
- 只广播领域事件：客户端状态重建复杂，且通用事件容易泄漏服务器私密载荷；
- GraphQL subscriptions：MVP 不需要任意查询形状，权限面更大；
- 自动重试所有客户端命令：秘密选择可能在用户已看到新状态后被错误重放，仅相同 `commandId` 的未确认发送可重试。

## 验证

- 网络在发送前、发送后、ack 前后断开时，最多产生一次规则效果；
- 乱序/重复 `room.view` 不回退本地状态；
- 连接恢复失败仍能通过 `RESYNC` 收敛；
- 所有角色的实时载荷通过秘密字段允许列表；
- 重连和事件重复不触发音频，主动重播产生新 `audioCueId`。

## 依据

- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)
- [Socket.IO connection state recovery](https://socket.io/docs/v4/connection-state-recovery/)


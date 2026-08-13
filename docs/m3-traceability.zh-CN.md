# M3 追踪文档：大厅、配置与身份揭示

状态：进行中（纵向切片推进，每轮对话完成一个切片）。

## 切片计划与进度

| 切片 | 范围 | 状态 | 完成日期 |
| --- | --- | --- | --- |
| 切片一 | `packages/game-engine`：ConfigureRoom/ReorderSeats/SetReady/LeaveLobby/KickLobbyPlayer/CloseRoom 的类型、handler、不变量与单元/性质测试 | ✅ 完成 | 2026-08-13 |
| 切片二 | `apps/server`：命令持久化、session 撤销、Outbox 单播、幂等与并发集成测试 | ✅ 完成 | 2026-08-14 |
| 切片三 | `packages/protocol`：`availableActions`/错误码/RoomView 投影审计与契约测试回归 | ✅ 完成 | 2026-08-14 |
| 切片四 | `apps/mobile`：命令提交、ack、重同步、纯逻辑 reducer/hook 与大厅 UI | 待开始 | — |
| 切片五 | 身份揭示、AckRole、后台遮罩与知识矩阵测试 | 待开始 | — |
| 切片六 | 完整命令矩阵、性质测试收尾、M3 追踪文档定稿、多房间负载场景 | 待开始 | — |

## 切片一详情：game-engine 大厅命令

### 范围

在 `packages/game-engine` 中实现规范 `docs/server-state-machine.zh-CN.md` §4.3 中 `SM-004`〜`SM-006`、`SM-017`〜`SM-019` 定义的六个大厅命令的纯领域逻辑：

- `ConfigureRoom`：仅 `LOBBY`、仅房主；复用 `normalizeRoomConfig` 校验配置合法性；目标人数小于当前在场人数时拒绝（不静默踢人）；成功后重置全员 `ready=false`。
- `ReorderSeats`：仅 `LOBBY`、仅房主；载荷必须是当前玩家 `playerId` 的完整排列（不多不少、不重复、不跨房）；成功后按新顺序赋值连续座次并重置全员 `ready=false`。
- `SetReady`：仅 `LOBBY`；任意玩家只能设置自己的准备状态。
- `LeaveLobby`：仅 `LOBBY`；房主不可调用（`HOST_CANNOT_LEAVE`）；移除自身、压缩座次、重置全员准备、产生 `SESSION_REVOKE_REQUESTED` 效果供应用层撤销会话。
- `KickLobbyPlayer`：仅 `LOBBY`、仅房主；目标必须存在且不是房主（`INVALID_TARGET`）；移除目标、压缩座次、重置全员准备、产生 `SESSION_REVOKE_REQUESTED` 效果。
- `CloseRoom`：仅 `LOBBY`、仅房主；产生 `ROOM_CLOSE_REQUESTED` 效果，供应用层删除房间、释放房间号、撤销全部会话；引擎自身不建模“终止”状态，只批准/拒绝并声明效果。

### 关键设计决策

1. **座次压缩规则**：移除玩家后，其余玩家按当前座次升序重新赋值为 `0..n-1` 的连续座次，相对顺序保持不变。
2. **领域效果而非直接广播**：`SESSION_REVOKE_REQUESTED` 与 `ROOM_CLOSE_REQUESTED` 是新增的 `DomainEffect` 变体，只被应用层消费，引擎本身不知道 session、Socket 或 Redis 的存在，保持纯函数与无副作用边界（对应 AGENTS.md §2）。
3. **配置变更不允许静默踢人**：`ConfigureRoom` 在新 `playerCount < state.players.length` 时返回 `INVALID_CONFIG`，不做任何裁剪；这是本切片新增的显式不变量测试点。
4. **座次重排必须是完整排列**：任何缺失、重复、多余或跨房 `playerId` 都返回 `INVALID_SEAT_ORDER`；不可增量提交。
5. **不新增 `GamePhase`**：`CloseRoom` 后房间对应的持久化记录由服务层删除，引擎层的 `GameState` 不表达“已关闭”这一终态，因为该状态永远不会再被读取（切片二实现）。

### 新增/变更文件

- `packages/game-engine/src/types.ts`：新增命令 union 成员、`EngineErrorCode` 新增 `INVALID_SEAT_ORDER`、`HOST_CANNOT_LEAVE`；新增 `DomainEffect` 变体 `SessionRevokeRequestedEffect`、`RoomCloseRequestedEffect`。
- `packages/game-engine/src/engine.ts`：新增六个 handler 与 `dispatch` 分支。
- `packages/game-engine/src/__tests__/helpers.ts`：扩展 `TestCommandBody` 与命令构造辅助函数以覆盖大厅命令。
- `packages/game-engine/src/command-matrix.test.ts`：新增大厅命令的接受/拒绝矩阵用例。
- `packages/game-engine/src/properties.test.ts`：新增座次连续性、ready 重置、配置/座次开局后冻结等不变量的表驱动/property 测试。

### 覆盖的规范编号

- `SM-004 ConfigureRoom`、`SM-005 ReorderSeats`、`SM-006 SetReady`、`SM-017 LeaveLobby`、`SM-018 KickLobbyPlayer`、`SM-019 CloseRoom`。
- `RULE`：座次连续性、准备重置、配置合法性（复用 M1 已实现的 `normalizeRoomConfig`/`validateRoleDeck`）。

### 未覆盖 / 遗留给后续切片

- 会话撤销的实际持久化（`SESSION_REVOKE_REQUESTED` 效果的消费）——切片二。
- 房间删除、房间号释放的实际数据库操作——切片二。
- 协议层 `ConfigureRoom`/`ReorderSeats` 等命令载荷到 `packages/protocol` Schema 的映射与契约测试——切片三。
- 移动端 UI 与纯逻辑——切片四。
- 多会话/多实例/并发集成测试——切片二起。

### 本切片验证命令与结果（2026-08-13 实测）

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @avalon/game-engine typecheck` | ✅ 通过 |
| `pnpm --filter @avalon/game-engine lint` | ✅ 通过（0 警告） |
| `pnpm --filter @avalon/game-engine test` | ✅ 138/138 通过（7 个测试文件） |
| `pnpm typecheck`（全仓库） | ✅ 通过 |
| `pnpm lint`（全仓库） | ✅ 通过 |
| `pnpm format:check`（全仓库） | ✅ 通过（已用 Prettier 自动修正 3 个文件的格式） |

### 新增测试清单

`packages/game-engine/src/lobby-commands.test.ts`（29 个用例）：

- `ConfigureRoom`：房主替换配置并重置全员准备；非房主拒绝（`NOT_HOST`）；非法角色组合拒绝（`INVALID_CONFIG`）；目标人数小于当前在场人数时拒绝而非静默踢人（`INVALID_CONFIG`）；仅 `LOBBY` 合法。
- `ReorderSeats`：房主重排座次并重置准备；非房主拒绝；缺失/重复/多余/跨房/空列表五种非法排列全部拒绝（`INVALID_SEAT_ORDER`）；仅 `LOBBY` 合法。
- `SetReady`：任意玩家只能改变自己的准备状态，其余玩家状态不受影响；仅 `LOBBY` 合法。
- `LeaveLobby`：移除玩家、压缩座次、重置全员准备、产生 `SESSION_REVOKE_REQUESTED` 效果；房主禁止调用（`HOST_CANNOT_LEAVE`）；仅 `LOBBY` 合法。
- `KickLobbyPlayer`：房主移除目标、压缩座次、重置准备、产生撤销效果；非房主拒绝；不能踢房主（`INVALID_TARGET`）；不存在/跨房目标拒绝；仅 `LOBBY` 合法。
- `CloseRoom`：房主关闭房间产生 `ROOM_CLOSE_REQUESTED` 效果；非房主拒绝；仅 `LOBBY` 合法。
- 幂等/版本语义：相同 `commandId`+相同载荷重放返回首次结果；相同 `commandId`+不同载荷返回 `DUPLICATE_COMMAND_CONFLICT`；`expectedStateVersion` 过期返回 `STALE_VERSION` 且不改变状态。

`packages/game-engine/src/properties.test.ts` 新增两组 property-based 测试（fast-check，`numRuns=80`，种子 `20260813`，可复现）：

1. **大厅命令序列不变量**：对 5～10 人房间，随机生成 0～25 步 `SetReady`/`ReorderSeats`/`ConfigureRoom`/`LeaveLobby`/`KickLobbyPlayer` 混合动作序列，每步之后断言 `collectInvariantViolations` 为空；序列结束时断言座次是从 0 开始的连续整数、`playerId` 唯一。
2. **开局后冻结**：对任意随机字节种子，`StartGame` 后再次尝试 `ConfigureRoom`/`ReorderSeats` 必须被拒绝（`INVALID_PHASE`）且状态未被修改。

### 已知限制（记录以避免遗忘，非本切片阻塞项）

- `apps/server/src/command-service.ts` 中的 `toEngineCommand` 仍对这六个命令类型返回 `undefined`（映射为 `INVALID_PHASE`），尚未消费新的 `SESSION_REVOKE_REQUESTED`/`ROOM_CLOSE_REQUESTED` 效果或做持久化——这是切片二的范围。
- `packages/protocol` 的 Schema 已经在此前的里程碑中声明了这些命令的 JSON Schema 形状（`command.schema.json`、`common.schema.json`），本切片未改动协议包；协议层命令载荷字段名与本切片引擎命令字段名的一致性核对（例如 `roleSelection` vs 协议侧字段）留给切片三处理。
- 尚未新增 `packages/game-engine/src/dependency-boundary.test.ts` 相关断言（该文件已存在且本次改动未使其失败，暂不需要新增边界测试，因为新命令未引入新的跨包依赖）。

## 切片二详情：apps/server 命令持久化与撤销

### 范围

在 `apps/server` 中接通切片一新增的六个大厅命令的应用服务层：

- `command-service.ts` 的 `toEngineCommand` 不再对 `ConfigureRoom`/`ReorderSeats`/`SetReady`/`LeaveLobby`/`KickLobbyPlayer`/`CloseRoom` 返回 `undefined`；改为把协议层 `Command` 载荷映射为引擎 `GameCommand`（`ConfigureRoom` 复用 `room-service.ts` 中新导出的 `toEngineConfig`）。
- 新增 `revokeSessionEffects`：在同一事务内消费引擎返回的 `SESSION_REVOKE_REQUESTED` 效果，将对应 `sessions` 行标记 `revoked_at`（不物理删除，保持外键完整性与审计轨迹）。
- 新增 `CloseRoom` 的 `ROOM_CLOSE_REQUESTED` 效果处理：在事务内 `delete from rooms where room_id = ...`，利用既有迁移的 `onDelete: 'CASCADE'` 级联清除 `players`/`sessions`/`processed_commands`/`outbox`。删除后不再写入 `processed_commands`（房间已不存在），因为任何重试都会在 `SESSION_INVALID`（会话已随房间级联删除）处得到安全的终态响应，满足幂等语义的实际效果（不会二次执行）。

### 关键设计决策

1. **会话撤销用标记而非删除**：`LeaveLobby`/`KickLobbyPlayer` 只设置 `revoked_at`，不删除 `sessions` 行，避免破坏 `processed_commands`/`outbox` 到 `sessions` 的隐式关联审计；`command-service.submit` 和 `outbox-worker` 已经统一通过 `revoked_at is null` 过滤，因此撤销立即生效，无需额外改动读路径。
2. **CloseRoom 跳过 `processed_commands` 写入**：因为房间行本身被删除，`processed_commands` 外键 `onDelete: 'CASCADE'` 也会级联清除该房间下所有已处理命令记录；重试同一 `CloseRoom` commandId 不会找到匹配的去重记录，但会在更早的“会话有效性检查”处失败（`SESSION_INVALID`），因为该房间的会话已随房间一起被删除。这是一个刻意的、文档化的幂等语义调整：**已关闭房间的重试请求总是安全地失败，绝不会产生副作用**，符合“失败命令不改变领域状态”的门槛要求。
3. **`toEngineConfig` 从 `room-service.ts` 导出**：避免在 `command-service.ts` 中重复实现 `CreateRoomRequest['config']` → 引擎 `RoomConfigInput` 的映射逻辑。
4. **`toEngineCommand` 从`| undefined` 改为非 `undefined` 返回类型**：由于协议层 `CommandTypeSchema` 与引擎 `GameCommand` 的 union 现已完全对齐，`switch` 语句可以对所有已知命令类型穷尽处理；保留一个 `default` 分支防止未来协议新增命令类型时静默丢弃。

### 新增/变更文件

- `apps/server/src/command-service.ts`：完整消费六个大厅命令；新增 `revokeSessionEffects` 私有方法；`CloseRoom` 分支的房间删除逻辑。
- `apps/server/src/room-service.ts`：`toEngineConfig` 改为具名导出（供 `command-service.ts` 复用）。
- `apps/server/src/m3-lobby.integration.test.ts`（新文件）：9 个多会话集成测试，覆盖持久化、撤销、幂等、并发。

### 覆盖的规范编号

- `SM-004 ConfigureRoom`、`SM-005 ReorderSeats`、`SM-006 SetReady`、`SM-017 LeaveLobby`、`SM-018 KickLobbyPlayer`、`SM-019 CloseRoom` 的应用服务层实现。
- 幂等/并发通用规则（`docs/server-state-machine.zh-CN.md` §4.2）：相同 `commandId`+相同载荷重放、不同载荷冲突、`expectedStateVersion` 过期拒绝、并发提交单一胜者。

### 本切片验证命令与结果（2026-08-14 实测）

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @avalon/server typecheck` | ✅ 通过 |
| `pnpm --filter @avalon/server lint` | ✅ 通过（0 警告） |
| `pnpm --filter @avalon/game-engine build`（前置：确保 server 消费最新引擎 dist） | ✅ 通过 |
| `pnpm --filter @avalon/server test:integration`（PostgreSQL + Redis Testcontainers） | ✅ 19/19 通过（3 个测试文件，新增 9 个 M3 大厅测试） |
| `pnpm typecheck`（全仓库） | ✅ 通过 |
| `pnpm lint`（全仓库） | ✅ 通过 |
| `pnpm test`（全仓库单元测试） | ✅ 全部通过 |
| `pnpm test:contract` | ✅ 52/52 通过 |
| `pnpm docs:check` | ✅ 通过 |
| `pnpm secret:scan` | ✅ 通过（无秘密泄漏） |
| `pnpm build`（全仓库） | ✅ 通过 |
| `pnpm format:check`（全仓库） | ✅ 通过（已用 Prettier 自动修正 2 个文件格式） |

### 新增集成测试清单

`apps/server/src/m3-lobby.integration.test.ts`（9 个用例，真实 PostgreSQL + Redis 容器，多个独立 `SessionContext`）：

1. **SM-006 SetReady 并发无丢失更新**：两名玩家针对同一 `expectedStateVersion` 并发提交 `SetReady`；断言恰好一个接受、一个 `STALE_VERSION`；败者用最新版本重试后两人的准备状态都正确持久化（无丢失更新）。
2. **SM-004 ConfigureRoom**：房主重新配置预设后全员 `ready` 重置为 `false`；非房主提交返回 `NOT_HOST`；目标人数小于当前在场人数返回 `INVALID_CONFIG`（不静默踢人）。
3. **SM-005 ReorderSeats**：非法列表（长度不符）返回 `INVALID_SEAT_ORDER`；两个合法但冲突的重排在同一 `expectedStateVersion` 下并发提交，断言恰好一个成功、一个 `STALE_VERSION`；成功后座次连续、准备重置。
4. **SM-017 LeaveLobby**：房主调用返回 `HOST_CANNOT_LEAVE`；普通玩家离开后座次压缩、准备重置、该玩家的 `sessions.revoked_at` 被标记；用已撤销会话重试任意命令返回 `SESSION_INVALID`。
5. **SM-018 KickLobbyPlayer**：非房主提交返回 `NOT_HOST`；踢房主自己返回 `INVALID_TARGET`；踢不存在/跨房目标返回 `INVALID_TARGET`；成功踢出后目标会话被标记撤销，其后续命令返回 `SESSION_INVALID`。
6. **SM-019 CloseRoom**：非房主提交返回 `NOT_HOST`；房主关闭后验证 `rooms`/`players`/`sessions`/`processed_commands`/`outbox` 五张表中该房间的行数全部归零（级联删除正确性）；关闭后任何人提交命令返回 `SESSION_INVALID`。
7. **CloseRoom 并发**：两个并发 `CloseRoom` 提交（同一房主），断言恰好一个 `accepted: true`，另一个失败——且失败原因是 `SESSION_INVALID`（因为败者事务提交时其自身会话已随房间级联删除），而非通用内部错误。
8. **幂等语义**：相同 `commandId`+相同载荷重放返回与首次完全相同的 `CommandResult`；相同 `commandId`+不同载荷返回 `DUPLICATE_COMMAND_CONFLICT`。
9. **Outbox 单播投影**：某玩家 `LeaveLobby` 后，`OutboxWorker` 排空一次；断言投递目标集合恰好等于“剩余玩家”的 `playerId` 集合（已撤销会话不在其中）；断言每条投递的 `PrivatePlayerProjection.playerId` 与投递目标一致（不存在跨玩家投影）；断言所有投递的公开玩家列表长度一致（无残留的已移除玩家）。

### 已知限制（记录以避免遗忘，非本切片阻塞项）

- `apps/server/src` 尚未对协议层 `availableActions` 做大厅命令的按角色（房主/普通玩家）投影填充——`room-service.ts` 中 `projectRoom` 的 `availableActions: []` 仍是 M2 遗留的占位注释（"M2 deliberately does not expose M3+ gameplay actions"）。这是切片三的范围。
- 未对 `ConfigureRoom` 载荷中协议 `Type.Array(RoleIdSchema, { minItems: 5, maxItems: 10 })` 等边界与引擎 `normalizeRoomConfig` 的错误码逐一做契约层交叉验证（例如载荷中人数超出 Schema 上限 10 时，是 Schema 校验先行拒绝还是引擎再校验）——这是切片三的范围。
- 移动端尚未消费这些命令——切片四范围。
- 本切片的多会话测试固定使用单一 `postgres.Sql` 连接池和单进程 `CommandService`/`OutboxWorker` 实例来模拟并发（通过 `Promise.all` 制造真实的数据库行级锁竞争），未额外起第二个 Node 进程/服务器实例；"两个服务实例处理同一房间命令保持单一权威结果"的更强多进程场景已由 `m2.integration.test.ts` 现有的双 `RoomService` 实例测试覆盖 `createRoom`/`joinRoom`，本切片未重复扩展到大厅命令的双进程场景（可在切片六统一补充，如认为有必要）。

## 切片三详情：protocol 层 availableActions/错误码/RoomView 投影审计

### 范围

对 `packages/protocol` 做静态审计与契约测试补强，核实切片一（引擎）与切片二（服务端）新增的六个大厅命令在协议层的 Schema 覆盖是否完整、准确、无遗漏，并为尚未实现的 `availableActions` 投影补充 Schema 层面的回归防线：

- 核对 `CommandTypeSchema`（`packages/protocol/src/schemas/common.ts`）与 `packages/game-engine/src/types.ts` 的 `GameCommand` union 是否逐项一致。
- 核对 `ErrorCodeSchema` 是否覆盖 `EngineErrorCode` 的全部值（含本次新增的 `INVALID_SEAT_ORDER`、`HOST_CANNOT_LEAVE`）。
- 审计 `command.schema.json`（`ConfigureRoom`/`ReorderSeats`/`SetReady`/`LeaveLobby`/`KickLobbyPlayer`/`CloseRoom` 载荷形状）与 `room-view.schema.json`（`AvailableActionSchema`、`eligibleTargetPlayerIds`）的既有定义，判断是否需要变更。
- 补充契约测试覆盖此前遗漏的验证分支（重复座位、`CUSTOM` 角色越界、`SetReady` 缺字段、无载荷命令携带多余字段等）。

### 关键设计决策

1. **审计结论：Schema 定义本身已完整，无需修改任何 `.schemas/*.ts` 源文件**。`CommandTypeSchema` 的 16 个字面量与引擎 `GameCommand` 的 16 个变体逐一核对完全一致；`ErrorCodeSchema` 的 32 个字面量是引擎 19 个 `EngineErrorCode`（含 `INVALID_SEAT_ORDER`、`HOST_CANNOT_LEAVE`）的严格超集（其余为会话/HTTP/限流等传输层错误码）。这两组 Schema 显然是在此前的里程碑中已按新命令同步维护，本切片未发现遗漏，因此没有对 `command.ts`/`common.ts`/`room-view.ts`/`room-config.ts` 做任何生产代码改动。
2. **新增"漂移防线"回归测试而非一次性核对**：由于 `packages/game-engine` 与 `packages/protocol` 按 ADR-007/依赖边界约束彼此不互相依赖（`game-engine` 不引用 `protocol`，反之亦然），二者的字面量集合只能靠人工保持同步。为了让未来任何一方新增/删除命令类型或错误码而忘记同步另一方时能被 CI 捕获，在 `protocol.contract.test.ts` 新增一组测试：把 `EngineErrorCode`/`GameCommand` 的权威定义以字面量数组的形式复制进测试文件（并注明来源文件路径与"手工同步"的性质），断言 `CommandTypeSchema` 与之完全相等、`ErrorCodeSchema` 是其超集。这是当前架构下代价最小、且不引入非法跨包依赖的漂移检测方式。
3. **`availableActions` 投影仍是空数组（`apps/server/src/room-service.ts` 的 `projectRoom`），本切片不实现其填充逻辑**：`availableActions` 的取值依赖房间当前阶段与请求者是否为房主等运行时状态，属于应用服务的投影职责而非协议 Schema 本身要表达的内容（协议只约束其结构形状）。真正把 `ConfigureRoom`/`ReorderSeats`/`SetReady`/`LeaveLobby`/`KickLobbyPlayer`/`CloseRoom` 按角色写入 `PrivatePlayerProjection.availableActions` 属于 `apps/server` 的改动，按纵向切片原则应在切片四（移动端消费前）或作为切片二的后续增量完成；本切片只负责在协议契约层面**提前验证**该形状本身是可行、无 Schema 冲突的，为后续实现提供一个已验证通过的目标契约（`lobbyRoomView` 契约夹具）。
4. **新增 `lobbyRoomView(forHost)` 契约夹具**（`packages/protocol/src/contract-fixtures.ts`）：构造 `LOBBY` 阶段的完整 `RoomView`，房主视角 `availableActions` 含 `ConfigureRoom`/`ReorderSeats`/`SetReady`/`KickLobbyPlayer`（含 `eligibleTargetPlayerIds`）/`CloseRoom`；非房主视角含 `SetReady`/`LeaveLobby`。这确认了 `AvailableActionSchema`（含可选的 `eligibleTargetPlayerIds`）足以表达大厅命令的可用性，且不需要 Schema 变更。

### 新增/变更文件

- `packages/protocol/src/contract-fixtures.ts`：新增 `lobbyRoomView(forHost: boolean): RoomView` 契约夹具函数。
- `packages/protocol/src/protocol.contract.test.ts`：新增 `describe('TEST-contract / M3 lobby command and error code drift guard', ...)` 测试块，含 9 个新测试（详见下文清单）。

### 覆盖的规范编号

- `SM-004`〜`SM-006`、`SM-017`〜`SM-019` 命令载荷的协议 Schema 完整性核对。
- `docs/architecture/ADR-007-contract-source-of-truth.md` 的"未声明字段默认拒绝"“Schema 只校验结构”原则在六个大厅命令上的契约测试落实。

### 本切片验证命令与结果（2026-08-14 实测）

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @avalon/protocol test:contract` | ✅ 61/61 通过（新增 9 个测试） |
| `pnpm --filter @avalon/protocol test` | ✅ 3/3 通过（非契约单元测试不受影响） |
| `pnpm --filter @avalon/protocol typecheck` | ✅ 通过 |
| `pnpm --filter @avalon/protocol lint` | ✅ 通过（0 警告） |
| `pnpm --filter @avalon/protocol generate:check` | ✅ 通过（未改动任何 Schema 源，`docs/contracts/*.schema.json` 快照无需重新生成） |
| `pnpm typecheck`（全仓库） | ✅ 通过（5 个工作区项目） |
| `pnpm lint`（全仓库） | ✅ 通过 |
| `pnpm test`（全仓库单元测试） | ✅ 全部通过（game-engine 138、protocol 3、mobile 12、test-fixtures 3、server 10） |
| `pnpm test:contract`（全仓库） | ✅ 61/61 通过 |
| `pnpm docs:check` | ✅ 通过（27 个 Markdown 文件 + 追踪范围核对） |
| `pnpm secret:scan` | ✅ 通过（无秘密泄漏） |
| `pnpm build`（全仓库） | ✅ 通过（含移动端 Expo web/iOS/Android 导出） |
| `pnpm format:check`（全仓库） | ✅ 通过（已用 Prettier 自动修正新增测试文件格式） |

### 新增契约测试清单

`packages/protocol/src/protocol.contract.test.ts` 新增 `describe('TEST-contract / M3 lobby command and error code drift guard', ...)`：

1. **`CommandTypeSchema` 与引擎 `GameCommand` 完全一致**：以硬编码的引擎权威列表（注明来源）与 Schema 提取的字面量集合做双向相等断言。
2. **`ErrorCodeSchema` 是引擎 `EngineErrorCode` 的超集**：逐一断言每个引擎错误码字面量都存在于协议 Schema 中。
3. **六个大厅命令均有契约夹具覆盖**：断言 `commandFixtures` 中六个大厅命令类型全部存在（防止未来新增命令时忘记补充夹具）。
4. **`ConfigureRoom` + `CUSTOM roleSelection` 越界（`roleIds` 少于 5 个）被拒绝**。
5. **`ConfigureRoom` + 合法 `CUSTOM roleSelection`（5 个角色）被接受**。
6. **`ReorderSeats` 携带重复 `playerId` 被拒绝**（`uniqueItems` 约束生效）。
7. **`SetReady` 缺少 `ready` 字段被拒绝**（必填字段约束生效）。
8. **`LeaveLobby`/`CloseRoom`（空载荷命令）携带多余字段被拒绝**（`additionalProperties: false` 生效）。
9. **`LOBBY` 阶段房主/非房主 `RoomView` 投影通过 Schema 校验，且 `availableActions` 内容符合预期的命令类型列表与 `eligibleTargetPlayerIds`**（使用新增的 `lobbyRoomView` 夹具）。

### 已知限制（记录以避免遗忘，非本切片阻塞项）

- `apps/server/src/room-service.ts` 中 `projectRoom` 的 `availableActions: []` **仍未实现真实填充**——本切片只验证了目标 Schema 形状可行，真正把大厅命令按房主/非房主角色写入 `PrivatePlayerProjection.availableActions` 的服务端改动尚未进行。若切片四（移动端）需要依赖真实的 `availableActions` 驱动 UI 可用状态，需要在开始切片四之前或作为切片四的第一步，先在 `apps/server` 补齐这一实现（并相应更新 `room-service.test.ts`/集成测试）。
- `CommandTypeSchema`/`ErrorCodeSchema` 与引擎权威列表的一致性检查是**硬编码字面量数组的手工同步**，不是自动从 `packages/game-engine` 源码提取（因两包不允许互相依赖）；若后续新增命令类型或错误码，需要同时更新三处：`packages/game-engine/src/types.ts`、`packages/protocol/src/schemas/common.ts`、`packages/protocol/src/protocol.contract.test.ts` 中的硬编码列表。此限制已在测试文件内联注释中明确标注。
- 移动端尚未消费这些命令与 Schema——切片四范围。


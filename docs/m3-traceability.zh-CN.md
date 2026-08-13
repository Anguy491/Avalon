# M3 追踪文档：大厅、配置与身份揭示

状态：✅ M3 六个纵向切片的实现与自动化验证已完成；人工原生验收、音频素材门槛及发布级容量验证见切片五/六已知限制。

## 切片计划与进度

| 切片 | 范围 | 状态 | 完成日期 |
| --- | --- | --- | --- |
| 切片一 | `packages/game-engine`：ConfigureRoom/ReorderSeats/SetReady/LeaveLobby/KickLobbyPlayer/CloseRoom 的类型、handler、不变量与单元/性质测试 | ✅ 完成 | 2026-08-13 |
| 切片二 | `apps/server`：命令持久化、session 撤销、Outbox 单播、幂等与并发集成测试 | ✅ 完成 | 2026-08-14 |
| 切片三 | `packages/protocol`：`availableActions`/错误码/RoomView 投影审计与契约测试回归 | ✅ 完成 | 2026-08-14 |
| 切片三.1（增量） | `apps/server`：`room-service.ts` 实现 `availableActions` 真实投影填充（LOBBY + ROLE_REVEAL），补齐切片三遗留的已知限制 | ✅ 完成 | 2026-08-14 |
| 切片四 | `apps/mobile`：命令提交、ack、重同步、纯逻辑 reducer/hook 与大厅 UI | ✅ 完成 | 2026-08-14 |
| 切片五 | 身份揭示、AckRole、后台遮罩与知识矩阵测试 | ✅ 完成 | 2026-08-14 |
| 切片六 | 完整命令矩阵、性质测试收尾、M3 追踪文档定稿、多房间负载场景 | ✅ 完成 | 2026-08-14 |

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

- ~~`apps/server/src/room-service.ts` 中 `projectRoom` 的 `availableActions: []` 仍未实现真实填充~~ → **已在切片三.1 中解决，见下文。**
- `CommandTypeSchema`/`ErrorCodeSchema` 与引擎权威列表的一致性检查是**硬编码字面量数组的手工同步**，不是自动从 `packages/game-engine` 源码提取（因两包不允许互相依赖）；若后续新增命令类型或错误码，需要同时更新三处：`packages/game-engine/src/types.ts`、`packages/protocol/src/schemas/common.ts`、`packages/protocol/src/protocol.contract.test.ts` 中的硬编码列表。此限制已在测试文件内联注释中明确标注。
- 移动端尚未消费这些命令与 Schema——切片四范围。

## 切片三.1（增量）：`apps/server` 的 `availableActions` 真实投影

### 范围

补齐切片三报告中记录的已知限制：在 `apps/server/src/room-service.ts` 中实现 `PrivatePlayerProjection.availableActions` 的真实计算，替换此前的占位空数组，覆盖 M3 里程碑命名范围内的两个阶段：

- **`LOBBY`**：`SetReady`（所有玩家）；房主额外获得 `ConfigureRoom`、`ReorderSeats`、`KickLobbyPlayer`（含 `eligibleTargetPlayerIds`）、`CloseRoom`，以及满足人数与全员 `ready`+`connected` 时的 `StartGame`；非房主额外获得 `LeaveLobby`。
- **`ROLE_REVEAL`**（身份揭示，M3 命名范围的一部分）：`phaseStage === 'COLLECTING'` 且本人尚未 `AckRole` 时提供 `AckRole`。

### 关键设计决策

1. **投影职责边界，不复制引擎裁决逻辑**：新增的 `computeAvailableActions()` 只做"UI 可用性提示"，其判定条件（房主身份、阶段、`phaseStage`、是否已提交）全部直接读取已经存在于 `GameState`/`PrivatePlayerState` 的公开或本人私有字段（`state.hostPlayerId`、`state.phase`、`state.phaseStage`、`privateGame.hasSubmitted`、`player.ready`/`player.connected`），不重新实现或旁路引擎的秘密计算、投票计票或任务结算逻辑。真正的裁决仍完全由 `packages/game-engine` 的 `executeCommand` 在命令提交时权威执行——`availableActions` 失真（例如网络延迟导致的过期投影）不会导致错误命令被接受，客户端提交的任何命令都会重新走一遍引擎校验。
2. **`StartGame` 就绪判断复用已公开字段**：`state.players.length === state.config.playerCount && state.players.every(p => p.ready && p.connected)` 与引擎 `startGame` handler 中的前两个前置条件同构，但这两个条件本身就是 `PublicSnapshot.players`/`config.playerCount` 已经暴露的公开信息的直接布尔组合，不涉及任何秘密派生，因此不构成"重复领域逻辑"的违规。
3. **范围止于 M3 命名边界**：`TEAM_PROPOSAL` 及之后的阶段（`SubmitTeam`/`SubmitTeamVote`/`SubmitQuestChoice`/`SelectMerlinTarget` 等）的 `availableActions` 填充故意未在本增量中实现，留给覆盖对局玩法 UI 的后续里程碑；`computeAvailableActions()` 对这些阶段返回空数组，与此前行为一致，不引入回归。
4. **测试策略**：不新增独立单元测试文件（`room-service.ts` 此前也没有专门的单元测试文件，只通过集成测试驱动），而是在既有的 `apps/server/src/m3-lobby.integration.test.ts` 中新增一个集成测试，通过真实的 `RoomService.readCurrentView()` 断言房主/非房主视角、`eligibleTargetPlayerIds`、`StartGame` 在未就绪/全员就绪两种状态下的出现与否；同时修正了 `m2.integration.test.ts` 中一处因新增非空 `availableActions` 而失效的旧断言（该断言原先预期非房主玩家的 `availableActions` 为空数组）。

### 新增/变更文件

- `apps/server/src/room-service.ts`：新增私有函数 `computeAvailableActions()`；`projectRoom()` 中 `availableActions` 从固定空数组改为调用该函数。
- `apps/server/src/m3-lobby.integration.test.ts`：新增测试 `'projects availableActions by role, gates StartGame on readiness, and lists eligible kick targets'`。
- `apps/server/src/m2.integration.test.ts`：修正一处因 `availableActions` 不再恒为空而过时的断言（现在断言非房主玩家在两人大厅中看到 `SetReady`+`LeaveLobby`）。

### 覆盖的规范编号

- `docs/server-state-machine.zh-CN.md` §6.2：`availableActions` "当前阶段本人可以执行的命令及合法静态选项"。
- `SM-004`〜`SM-006`、`SM-017`〜`SM-019`（大厅命令可用性）、`AckRole`（身份揭示可用性）的 UI 投影落地。

### 本次验证命令与结果（2026-08-14 实测）

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @avalon/server typecheck` | ✅ 通过 |
| `pnpm --filter @avalon/server lint` | ✅ 通过（0 警告） |
| `pnpm --filter @avalon/server test` | ✅ 10/10 通过 |
| `pnpm --filter @avalon/server test:integration` | ✅ 20/20 通过（新增 1 个 availableActions 测试，m2 既有断言已修正） |
| `pnpm typecheck`（全仓库） | ✅ 通过 |
| `pnpm lint`（全仓库） | ✅ 通过 |
| `pnpm test`（全仓库单元测试） | ✅ 全部通过 |
| `pnpm test:contract` | ✅ 61/61 通过（未改动协议 Schema，不受影响） |
| `pnpm docs:check` | ✅ 通过 |
| `pnpm secret:scan` | ✅ 通过 |
| `pnpm build`（全仓库） | ✅ 通过（含移动端 Expo 导出） |
| `pnpm format:check`（全仓库） | ✅ 通过（已用 Prettier 自动修正新增测试文件格式） |

### 已知限制（记录以避免遗忘，留给后续切片）

- `TEAM_PROPOSAL`/`TEAM_VOTE`/`QUEST_SUBMISSION`/`ASSASSINATION` 等对局阶段的 `availableActions` 仍返回空数组，尚未实现（超出 M3 命名范围：大厅、配置、身份揭示）。
- `room-service.ts` 目前没有独立的单元测试文件，`computeAvailableActions()` 的行为完全由集成测试驱动验证；如果未来该函数复杂度显著上升，建议拆分为可独立单元测试的纯函数模块。

## 切片四详情：`apps/mobile` 大厅命令、ack、重同步与 UI

### 范围

在既有 M2 会话恢复、SecureStore、Socket.IO 和 `RoomView` Query cache 基础上，完成六个大厅命令的移动端纵向消费：

- `ConfigureRoom`：房主可编辑 5–10 人目标、经典/常用角色预设或自定义公开角色列表；提交完整 `RoomConfigInput`，服务端成功后关闭编辑页并提示全员重新准备。
- `ReorderSeats`：房主通过可访问的“上移/下移”调整投影中的玩家顺序，一次提交完整 `playerIds` 排列；不在客户端判断排列是否合法。
- `SetReady`：本人根据服务端投影中的当前准备状态提交相反布尔值；等待 ack 时按钮进入 busy/disabled 状态。
- `LeaveLobby`、`KickLobbyPlayer`、`CloseRoom`：均提供包含昵称/影响说明且不显示内部 ID 的确认对话框；本人离开或房主关闭成功后清除安全存储中的会话并返回首页。
- `command.submit` 通道：每条命令携带新的 `commandId`、当前 `RoomView.public.stateVersion` 作为 `expectedStateVersion` 及 `sentAt`；ack 通过协议层 `isCommandResult` 守卫校验。
- 重同步：`STALE_VERSION`、权限/阶段变化和重复提交类拒绝会通过已有 HTTP 当前投影接口刷新；Socket `room.view` 与 HTTP 刷新都按 `stateVersion` 收敛，较旧响应不能覆盖较新投影。

### 关键设计决策

1. **可执行动作只消费 `availableActions`**：`deriveLobbyUiState()` 只排序公开座次、定位本人并把 `availableActions` 转成 UI 控件集合；`KickLobbyPlayer` 的目标严格取自服务端提供的 `eligibleTargetPlayerIds`。客户端不根据房主标记、人数、ready 数量或阶段自行推导命令权限，也不复制座次/角色配置裁决。
2. **ack 超时复用完整命令信封**：`RoomCommandAttempts` 按 `roomId + expectedStateVersion + input` 保存待确认命令；Socket ack 4 秒超时后自动做一次有界重试，两次发送复用同一对象，因此 `commandId`、载荷、版本和 `sentAt` 均完全相同。若仍无 ack，保留该信封供用户再次确认同一操作时重用；收到明确接受/拒绝后才释放。
3. **ack 与投影独立收敛**：接受 ack 后进行一次机会式 HTTP 重同步，同时继续接受可能先到或后到的 Socket 投影；两条路径统一使用 `acceptNewerRoomView()`。成功 UI 仍以投影为准，不对本地玩家列表、ready 或配置做乐观写入。
4. **稳定错误码本地化，不暴露内部载荷**：命令拒绝转换为既有 `ApiError` 并复用 `userFacingError()` 的完整 `ErrorCode` 映射；UI 只显示本地化文案，不渲染原始请求、堆栈、会话令牌或服务端内部主键。ack 协议异常和网络超时使用固定客户端文案。
5. **自定义配置只做协议结构编辑**：自定义角色 UI 支持同一普通角色出现多次，并只检查协议规定的 5–10 个数组边界；梅林/刺客、阵营数量、特殊角色依赖等规则仍由 `packages/game-engine` 在服务端统一裁决，避免在移动端复制领域算法。
6. **生命周期命令显式清理本人会话**：`LeaveLobby`/`CloseRoom` 接受后立即调用既有 `clearStoredSession()`；同时监听协议声明的 `session.revoked` 事件，为被移除/关闭的客户端提供安全清理路径。其他玩家的私密投影从未写入本地持久化。
7. **切片边界停在大厅六命令**：虽然服务端可能在 `availableActions` 中投影 `StartGame`，本切片不渲染或提交它；`StartGame`、身份页路由和 `AckRole` 与后台遮罩一起留给切片五，避免开放尚未具备隐私门的角色流程。

### 新增/变更文件

- `apps/mobile/src/session/command-submission.ts`（新增）：六种大厅命令输入类型、完整命令信封复用、ack 超时/协议异常、Socket 有界重试和拒绝后重同步分类。
- `apps/mobile/src/session/command-submission.test.ts`（新增）：6 个单元测试，覆盖信封复用、版本变化换新 ID、超时同信封重试、超时终止、畸形 ack 拒绝和重同步分类。
- `apps/mobile/src/session/session-provider.tsx`：接入 `command.submit`、pending 命令状态、ack Schema 守卫、拒绝本地化、HTTP 重同步、`session.revoked` 清理及离开/关闭后的本机会话清除。
- `apps/mobile/src/features/rooms/lobby-state.ts`（新增）：`RoomView` → 大厅 UI 状态的纯派生函数，以及座次/配置草稿 reducer；仅处理展示和协议结构，不做领域裁决。
- `apps/mobile/src/features/rooms/lobby-state.test.ts`（新增）：4 个单元测试，覆盖服务端动作驱动、踢人目标、座次完整排列草稿和配置结构草稿。
- `apps/mobile/src/features/rooms/use-lobby-commands.ts`（新增）：六命令 hook，统一成功提示，并在本人离开/关闭房间后返回首页。
- `apps/mobile/src/features/rooms/lobby-editors.tsx`（新增）：可滚动的配置与座次编辑 modal，含动态字体友好的布局、44pt 触控目标、读屏标签和 busy 状态。
- `apps/mobile/src/features/rooms/lobby-screen.tsx`：移除 M2 占位提示，接入玩家/公开配置、准备、移除、退出、关闭、配置和座次 UI；保留房间号复制与公开 QR。

### 覆盖的规范编号

- 状态机：`SM-004 ConfigureRoom`、`SM-005 ReorderSeats`、`SM-006 SetReady`、`SM-017 LeaveLobby`、`SM-018 KickLobbyPlayer`、`SM-019 CloseRoom`；`docs/server-state-machine.zh-CN.md` §4.2 幂等/版本语义与 §6.2 `availableActions`。
- 移动端：`FR-003`、`FR-007`〜`FR-014`、`FR-046`、`FR-047`；`UX-006` 大厅、`UX-016` 错误与重同步、UX §6 确认/反馈、`NFR-019`、`NFR-022`。
- 验收关联：`AC-001` 的大厅配置/座次/准备客户端路径（服务端规则合法性已由前序切片覆盖）、`AC-009` 的同命令重试客户端语义；本切片新增单测名称和本节均保留对应 `SM`/`FR` 追踪。

### 本切片验证命令与结果（2026-08-14 实测）

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @avalon/mobile typecheck` | ✅ 通过 |
| `pnpm --filter @avalon/mobile lint` | ✅ 通过（0 警告） |
| `pnpm --filter @avalon/mobile test` | ✅ 22/22 通过（8 个测试文件；本切片新增 10 个测试） |
| `pnpm format:check`（全仓库） | ✅ 通过 |
| `pnpm lint`（全仓库） | ✅ 通过（0 警告） |
| `pnpm typecheck`（全仓库） | ✅ 通过（5 个工作区项目） |
| `pnpm test`（全仓库单元测试） | ✅ 全部通过（game-engine 138、protocol 3、mobile 22、test-fixtures 3、server 10） |
| `pnpm test:contract` | ✅ 61/61 通过 |
| `pnpm secret:scan` | ✅ 通过（无秘密泄漏） |
| `pnpm build`（全仓库） | ✅ 通过（含 Expo web/iOS/Android 导出） |
| `pnpm docs:check` | ✅ 通过（27 个 Markdown 文件 + 协议生成快照检查） |

### 已知限制（按纵向切片留给后续）

- `StartGame`、身份揭示路由、`AckRole`、后台遮罩与角色知识矩阵明确属于切片五，本切片未开放 `StartGame` 控件。
- 自定义角色编辑器不在客户端复制引擎硬校验，因此 `FR-012` 要求的完整即时角色组合错误目前仍由提交后的 `INVALID_CONFIG` 表达；若后续需要提交前完整提示，应新增不改变权威性的共享验证端口/协议，而不是在 `apps/mobile` 复制规则。
- `FR-016` 的“测试主持语音”仍受 `M3-GATE-01` 音频内容/授权门槛约束，本切片没有新增权属不明的音频或第三方 SDK；固定占位音频与字幕接入尚未完成。
- 按本轮明确范围未新增/运行模拟器、Maestro E2E、截图或录屏。因而原生确认对话框、最大动态字体、VoiceOver/TalkBack 和视觉状态仍需用户手工验收；本切片只完成静态可访问性属性、单元检查与 Expo 三平台构建证据。
- 本切片未改动 `apps/server`，未重跑 Docker 集成测试；切片三.1 已记录的 20/20 服务端集成测试结果保持不变。

## 切片五详情：身份揭示、`AckRole`、后台遮罩与知识矩阵

### 范围

完成从大厅开局到身份确认结束的 M3 纵向路径，并把私密信息边界落实到移动端展示、服务端投影和日志防御三层：

- 大厅房主根据服务端 `availableActions` 看到并提交 `StartGame`；确认对话说明开局后配置和座次冻结。成功后房主进入 `/(game)/role`，其他玩家随 `RoomView` 阶段投影自动进入同一路由。
- `ROLE_REVEAL/HOST_HELD` 时仅房主获得 `ContinuePhase`；所有玩家可先通过隐私门查看自己的角色。房主继续后进入 `COLLECTING`，未确认玩家才获得 `AckRole`。
- 身份页只消费本人 `PrivatePlayerProjection`：角色、阵营、能力说明及服务端提供的 `knownPlayers[].knowledgeLabel`；客户端只把语义标签映射为中文，不计算梅林、派西维尔或邪恶互认知识。
- 隐私门默认遮蔽；持续按住 600ms 才揭示且松手立即遮蔽，同时提供读屏和行动不便用户可用的点按揭示/隐藏模式。只有主动揭示后才把无障碍焦点移到角色标题。
- `AppState` 离开 `active` 时立即回到中性遮罩，回到前台不会自动重新展示；确认 `AckRole` 前有二次确认，提交动作先本地遮蔽，服务端投影确认后保持中性等待页。
- 公开区域只展示 `submittedCount / requiredCount`，不展示尚未确认者；全员确认后由服务端权威自动推进到 `TEAM_PROPOSAL/HOST_HELD`。
- 新增 10 人特殊角色知识矩阵集成测试，逐会话核验本人角色/阵营/知识及 StartGame Outbox 个性化单播；同时扩充服务端日志脱敏字段，覆盖角色、阵营、知识和任务私密选项。

### 关键设计决策

1. **路由只表达位置，动作仍由投影授权**：移动端不根据房主身份、阶段或本人确认状态推导 `StartGame`/`ContinuePhase`/`AckRole` 权限。按钮的出现和启用只读取 `PrivatePlayerProjection.availableActions`；服务端 `computeAvailableActions()` 补齐 `ROLE_REVEAL/HOST_HELD` 的房主 `ContinuePhase`，引擎仍在每次提交时重新裁决。
2. **私密知识不在客户端重建**：`deriveRoleRevealUiState()` 仅把 `knownPlayers` 的玩家 ID 连接到公开昵称，并翻译协议稳定语义标签。角色能力文案是公开说明；实际知识名单完全来自本人投影，移动端没有梅林排除莫德雷德、派西维尔候选或邪恶排除奥伯伦的算法副本。
3. **按住揭示的事件节点保持稳定**：私密面板在遮蔽/揭示切换时复用同一个 `Pressable` 手势节点，避免长按触发后因子树替换丢失 `onPressOut`；`HOLD` 模式松手必回到 `MASKED`。点按模式是显式等价替代，不会在回到前台时自动恢复。
4. **确认采用“先遮蔽、后提交、以投影收敛”**：用户二次确认后先派发本地 `conceal`，再通过切片四的同一幂等命令通道提交 `AckRole`。ack 超时仍复用同一 `commandId`；拒绝按错误码本地化并重同步；客户端不乐观增加公开确认计数。
5. **不持久化角色投影**：`RoomView` 只存在于 React Query 内存缓存；SecureStore 继续只保存本人会话令牌和恢复所需公开元数据。身份页不提供复制、分享、导出或可选择文本入口，也不把角色内容写入通知、日志或分析事件。
6. **矩阵测试独立断言规则而非自证实现**：服务端集成测试使用包含全部特殊角色的合法 10 人牌组，从持久化角色分配独立构造各视角期望集合，逐一核验梅林排除莫德雷德、派西维尔候选不可区分、邪恶互认排除奥伯伦、奥伯伦无同伴知识；并按 StartGame 对应 Outbox `eventId` 精确检查 10 条会话绑定投递。

### 新增/变更文件

- `apps/mobile/src/features/roles/role-reveal-state.ts`（新增）：八种角色公开展示文案、`RoomView` 纯派生函数与隐私门 reducer。
- `apps/mobile/src/features/roles/role-reveal-state.test.ts`（新增）：语义知识映射、八角色展示覆盖、按住/松手、后台遮蔽和确认归零测试。
- `apps/mobile/src/features/roles/use-role-commands.ts`（新增）：`ContinuePhase`/`AckRole` 命令 hook。
- `apps/mobile/src/features/roles/role-reveal-screen.tsx`（新增）：身份隐私门、揭示、确认进度、后台遮罩、无障碍焦点和中性等待 UI。
- `apps/mobile/src/app/(game)/role.tsx`（新增）：`UX-008` 身份路由。
- `apps/mobile/src/app/(game)/_layout.tsx`、`apps/mobile/src/app/(public)/index.tsx`：游戏栈主题与会话恢复阶段路由。
- `apps/mobile/src/features/rooms/lobby-screen.tsx`、`apps/mobile/src/features/rooms/use-lobby-commands.ts`：房主 `StartGame` 确认、提交和身份页导航。
- `apps/mobile/src/session/command-submission.ts`、`apps/mobile/src/session/session-provider.tsx`：既有幂等通道扩展到 `StartGame`、`ContinuePhase`、`AckRole`，统一命名为 `submitCommand`。
- `apps/server/src/room-service.ts`：`ROLE_REVEAL/HOST_HELD` 为房主投影 `ContinuePhase`；`COLLECTING` 保持按本人提交状态投影 `AckRole`。
- `apps/server/src/m3-lobby.integration.test.ts`：新增完整身份阶段门和 10 人特殊角色知识/Outbox 单播矩阵测试。
- `apps/server/src/observability.ts`、`apps/server/src/server.test.ts`：扩充私密角色字段日志脱敏防线及回归断言。

### 覆盖的规范编号

- 规则与状态机：`RULE-004`、`RULE-006`、`RULE-007`；`SM-007 StartGame`、`SM-008 ContinuePhase`、`SM-009 AckRole`，以及 §6.2 `availableActions`。
- 移动端与交互：`FR-015`、`FR-017`〜`FR-020`；`UX-008`；`NFR-014`、`NFR-019`、`NFR-022`。
- 验收关联：`AC-008`（全部特殊角色个人知识投影）、`AC-015`（公开投影/实时单播/日志中不出现越权角色或令牌）。

### 本切片验证命令与结果（2026-08-14 实测）

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @avalon/mobile typecheck` | ✅ 通过 |
| `pnpm --filter @avalon/mobile lint` | ✅ 通过（0 警告） |
| `pnpm --filter @avalon/mobile test` | ✅ 27/27 通过（9 个测试文件；本切片新增 5 个身份纯逻辑测试） |
| `pnpm --filter @avalon/server typecheck` | ✅ 通过 |
| `pnpm --filter @avalon/server lint` | ✅ 通过（0 警告） |
| `pnpm --filter @avalon/server test` | ✅ 10/10 通过 |
| `pnpm --filter @avalon/server test:integration`（PostgreSQL + Redis Testcontainers） | ✅ 22/22 通过（3 个测试文件；M3 文件新增 2 个身份测试） |
| `pnpm format:check`（全仓库） | ✅ 通过 |
| `pnpm lint`（全仓库） | ✅ 通过（0 警告） |
| `pnpm typecheck`（全仓库） | ✅ 通过（5 个工作区项目） |
| `pnpm test`（全仓库单元测试） | ✅ 全部通过（game-engine 138、protocol 3、mobile 27、test-fixtures 3、server 10） |
| `pnpm test:contract` | ✅ 61/61 通过 |
| `pnpm docs:check` | ✅ 通过（27 个 Markdown 文件 + 协议生成快照检查） |
| `pnpm secret:scan` | ✅ 通过（无秘密泄漏） |
| `pnpm build`（全仓库） | ✅ 通过（含 Expo web/iOS/Android 导出） |

### 已知限制（按纵向切片边界记录）

- 按本轮明确范围未新增/运行模拟器、Maestro E2E、截图或录屏；因此 AppState 遮罩在 iOS/Android 应用切换器抓帧时序、长按 600ms 手感、最大动态字体和 VoiceOver/TalkBack 焦点仍需用户手工验收。本切片已完成 reducer 测试、静态无障碍属性和 Expo 三平台构建验证。
- 当前实现使用 `AppState` 在退后台/失活时切换中性遮罩，并明确提示系统无法绝对阻止主动拍摄；未新增平台专用的截屏阻止或录屏状态侦测原生模块。若邀请测试要求 Android `FLAG_SECURE` 或录屏事件联动，应作为纵深防御单独评估，不能把它当作角色保密的唯一边界。
- `TEAM_PROPOSAL` 及之后的实际对局 UI/`availableActions` 仍超出 M3“大厅、配置与身份揭示”范围；全员 `AckRole` 后先进入既有公共游戏占位路由，后续里程碑再实现组队、投票、任务与刺杀交互。
- `FR-016` 的测试主持语音及 StartGame 生成的开场音频仍受 `M3-GATE-01` 内容授权门槛约束；本切片没有引入权属不明音频、运行时 TTS 或新的第三方数据采集 SDK。

## 切片六详情：命令矩阵、性质测试与多房间负载收尾

### 范围

完成 M3 的自动化验证收尾，并把短时多房间场景从 M2 的纯 HTTP 创建/加入扩展为完整 M3 身份流程：

- 将 `packages/game-engine/src/command-matrix.test.ts` 的通用成功/非法参与者/过期版本/幂等重放/摘要冲突/不变量矩阵从原有 10 个对局命令扩展到全部 16 个 `GameCommand`，补入 `ConfigureRoom`、`ReorderSeats`、`SetReady`、`LeaveLobby`、`KickLobbyPlayer`、`CloseRoom`。
- 新增矩阵完整性断言：命令用例名称必须与 16 个权威命令字面量完全一致且不重复，防止未来只新增命令实现而漏掉通用语义回归。
- 收紧 M3 大厅性质测试：每次接受配置、座次、离开或移除变更后立即断言全员 `ready=false`；开局冻结测试从仅检查配置/座次扩展为六个大厅命令全部返回 `INVALID_PHASE`，并验证配置、玩家/座次及角色分配保持不变，移除原先无效的自比较断言。
- 重写 `scripts/load-smoke.mjs`：默认创建 20 个并发 10 人房并建立 200 条真实 Socket.IO 连接，每房依次完成全员 `SetReady`、`StartGame`、同一 StartGame 信封幂等重放、房主 `ContinuePhase`、全员 `AckRole`，最终到达 `TEAM_PROPOSAL/HOST_HELD`。
- 负载场景逐条检查实时投影的房间/玩家绑定，递归扫描公开快照禁止字段，并等待所有 200 个个性化投影收敛到最终版本；只输出聚合延迟与通过状态，不输出房间号、玩家 ID、角色、知识或会话令牌。
- 定稿本追踪文档及 `docs/development.zh-CN.md` 的 M3 负载运行说明，明确区分短时切片 smoke 与 M7 发布级容量门槛。

### 关键设计决策

1. **完整矩阵与专项测试互补**：`lobby-commands.test.ts` 继续负责每个大厅命令的精细拒绝原因和领域效果；通用矩阵统一验证所有 16 个命令共享的版本、幂等、冲突和不变量语义，避免把两类证据合并成难以诊断的大测试。
2. **所有矩阵初始状态均具有非零版本**：新增大厅用例先执行一次合法 `SetReady`，`StartGame` 用例先执行准备状态往返，因此通用矩阵确实执行 `STALE_VERSION` 分支，而不是因初始 `stateVersion=0` 跳过断言。
3. **性质测试在每次相关转换后立即取证**：准备重置不能只从动作序列终态推断，因为后续 `SetReady` 合法地重新置为 `true`；断言放在每个接受的配置/座次/离开/移除转换之后，失败时 fast-check 仍能给出最小可复现序列。
4. **负载按房间内串行、房间间并行**：同房命令必须携带最新 `expectedStateVersion`，因此每个房间内部按 ack 顺序推进；20 个房间并行执行以制造数据库、Redis、Outbox 和 Socket.IO 的跨房竞争，同时不人为制造应被 `STALE_VERSION` 拒绝的无效业务负载。
5. **同一 StartGame 信封原样重放**：负载脚本复用完全相同的 `commandId`、版本、载荷和时间戳，断言重放仍接受且 `stateVersion` 不增长，覆盖真实 Socket 通道上的 `NFR-007`/`AC-009` 幂等语义。
6. **投影安全检查靠结构而非秘密值匹配**：脚本递归拒绝公开模型中的 `roleAssignments`、`privateKnowledge`、本人角色/知识、票和任务选择字段，并断言每条私密投影的 `playerId`、公开 `roomId` 与当前连接绑定一致；不会把真实测试角色或令牌写入输出/报告。
7. **不冒充发布级容量验证**：`LOAD_ROOM_COUNT` 仍允许 1–1,000，但本切片实测为短时 20 房/200 连接。`NFR-004` 要求的 1,000 房/10,000 连接、混合阶段、连接抖动和持续 30 分钟运行明确保留给 M7，不以本次 smoke 结果替代。

### 新增/变更文件

- `packages/game-engine/src/command-matrix.test.ts`：新增六个大厅命令的通用矩阵用例、非零版本 setup 和 16 命令完整性断言。
- `packages/game-engine/src/properties.test.ts`：收紧 ready 重置即时断言；六大厅命令开局冻结及角色分配不可变性质。
- `scripts/load-smoke.mjs`：M3 多房间 Socket.IO 身份流程、幂等重放、延迟分位数、投影隔离与公开秘密字段扫描。
- `package.json`、`pnpm-lock.yaml`：根开发依赖新增锁定版本 `socket.io-client@4.8.3`，供仓库级负载脚本使用。
- `docs/development.zh-CN.md`：更新 `test:load` 的 M3 场景、阈值、环境参数与范围边界。
- `docs/m3-traceability.zh-CN.md`：切片六完成记录及 M3 总体状态定稿。

### 覆盖的规范编号

- 大厅与身份状态机：`SM-004`〜`SM-009`、`SM-017`〜`SM-019`；所有 `GameCommand` 的 §4.2 `commandId`/`expectedStateVersion` 通用语义。
- 规则与验收：`RULE-004`、`RULE-006`、`RULE-007`；`AC-008`、`AC-009`、`AC-015`。
- 非功能：`NFR-002`（创建/加入 p95）、`NFR-003`（命令 ack/最终投影 p95）、`NFR-007`（成功命令幂等重放）、`NFR-014`（个性化投影与公开秘密扫描）。

### 多房间负载实测（2026-08-14，本地 PostgreSQL + Redis，隔离端口）

| 指标 | 样本 | p50 | p95 | p99 | 门槛/结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| 创建房间 | 20 | 109.3ms | 127.1ms | 127.3ms | `NFR-002` 2,000ms，✅ |
| 加入房间 | 180 | 226.3ms | 376.7ms | 390.0ms | `NFR-002` 2,000ms，✅ |
| 实时连接并收到 `session.ready` | 200 | 42.3ms | 44.1ms | 44.2ms | 脚本 smoke 门槛 2,000ms，✅ |
| 命令 ack | 460 | 22.9ms | 31.1ms | 31.9ms | `NFR-003` 1,000ms，✅ |
| 最终个性化投影收敛 | 20 房 | 220.0ms | 663.5ms | 705.7ms | `NFR-003` 1,000ms，✅ |

附加断言：HTTP/命令零错误；20 个 `roomId` 唯一；StartGame 重放不增加版本；200 条连接未发现错房或错玩家投影；公开秘密字段扫描零命中；20 个房间均到达 `TEAM_PROPOSAL/HOST_HELD`。

### 本切片验证命令与结果（2026-08-14 实测）

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @avalon/game-engine typecheck` | ✅ 通过 |
| `pnpm --filter @avalon/game-engine lint` | ✅ 通过（0 警告） |
| `pnpm --filter @avalon/game-engine test` | ✅ 145/145 通过（7 个测试文件；命令矩阵由 10 扩展到 16 个命令并新增完整性测试） |
| `LOAD_BASE_URL=http://127.0.0.1:3100 pnpm test:load` | ✅ 20 房/200 连接/460 命令 ack；零错误、隔离/秘密扫描通过，全部 p95 达标 |
| `pnpm --filter @avalon/server test:integration` | ✅ 22/22 通过（3 个测试文件，PostgreSQL + Redis Testcontainers） |
| `pnpm format:check`（全仓库） | ✅ 通过 |
| `pnpm lint`（全仓库） | ✅ 通过（0 警告） |
| `pnpm typecheck`（全仓库） | ✅ 通过（5 个工作区项目） |
| `pnpm test`（全仓库单元测试） | ✅ 全部通过（game-engine 145、protocol 3、mobile 27、test-fixtures 3、server 10） |
| `pnpm test:contract` | ✅ 61/61 通过 |
| `pnpm docs:check` | ✅ 通过（27 个 Markdown 文件 + 协议生成快照检查） |
| `pnpm secret:scan` | ✅ 通过（无秘密泄漏） |
| `pnpm build`（全仓库） | ✅ 通过（含 Expo web/iOS/Android 导出） |

### M3 收尾结论与已知限制

- 六个纵向切片的代码与自动化验证已完成；M3 对应的大厅、配置、开局、个性化身份揭示和 `AckRole` 服务端/协议/移动端路径已形成可追踪闭环。
- 按用户明确范围，切片四至六未运行或新增模拟器、Maestro、截图和录屏。Roadmap 退出门槛中的最大动态字体、VoiceOver/TalkBack、安全完成身份确认及 AppState 原生任务切换器时序仍需用户手工验收，不能由 Expo bundle 构建代替。
- `FR-016` 测试主持语音与开场音频仍受 `M3-GATE-01` 音频内容/授权决定约束；这是外部素材门槛，不在本切片擅自引入权属不明资源。
- 本次 20 房/200 连接结果只证明本地短时 M3 smoke。`NFR-004` 的 1,000 房/10,000 连接持续 30 分钟、混合游戏阶段、5% 连接抖动、1% 重连和基础设施资源曲线仍由 `M7-004` 完成。
- `TEAM_PROPOSAL` 及之后的 `availableActions` 和实际移动对局 UI 属于 M4+；M3 只保证身份确认完成后权威进入 `TEAM_PROPOSAL/HOST_HELD`，不提前实现后续裁决界面。

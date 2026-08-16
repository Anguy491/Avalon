# M6 断线恢复与固定语音主持追踪

## 1. 交付状态

| Issue | 本次实现 | 证据 | 状态 |
| --- | --- | --- | --- |
| `M6-001` | 严格心跳/撤销/维护/音频遥测契约；Unicode 暂停原因；10 秒 Socket 租约；60 分钟活跃暂停期限；在线选民终止投票；滚动会话续期；恢复/投票期限和 Outbox cue 迁移 | `protocol.contract.test.ts`、`engine.test.ts`、`m3-lobby.integration.test.ts`、`000003_m6_recovery_audio_delivery.cjs`、`000005_pause_termination_vote.cjs` | 已实现；容器集成需可用 Docker runtime 复验 |
| `M6-002` | 启动/回前台单飞 HTTP 恢复；`session.ready/RESYNC` 后才连接；NetInfo、有限退避、草稿清理信号、连接提示和暂停遮罩 | `session-provider.tsx`、`session-status-layer.tsx`、移动端组件测试 | 已实现；原生视觉证据待设备运行 |
| `M6-003` | 正式中文音频、字幕、清单、哈希、授权与播放器 | 无获批素材、逐字字幕或书面授权记录 | **资产门槛阻塞，未实现** |
| `M6-004` | Outbox 仅记录事务中新 cue；只有房主匹配 `LIVE` cue 时 `shouldPlayAudio=true`；`RESYNC` 恒 false；客户端保留投影信封；主动重播命令已贯通；最小聚合遥测契约 | `m5-projection.test.ts`、契约测试 | 服务端语义已实现；播放器去重/中断处理随 `M6-003` 阻塞 |
| `M6-005` | 追踪、自动检查与故障测试基础 | 本文与 CI 命令结果 | iOS/Android 截图、真机音频中断和 30 分钟目标负载待外部运行条件 |

不得用临时 TTS、权属不明音频或占位字幕越过 `M6-003` 门槛。素材获批后应以独立纵向增量补齐资源清单、生成映射、哈希校验、播放器和原生证据。

## 2. 需求映射

| 规范编号 | 实现位置 | 验收证据 |
| --- | --- | --- |
| `RULE-021` | `packages/game-engine` 的固定 `AudioCue` 与显式 `ReplayAudioCue`；Outbox cue 实例 | `engine.test.ts`、`m5-projection.test.ts` |
| `RULE-022`–`RULE-023` | `applyConnectionChanged`、`ConnectionService`、终止投票领域命令、固定 `hostPlayerId` | 暂停原因/秘密保持、在线选民快照、严格多数和截止测试；连接租约集成测试 |
| `SM-003` | HTTP 原子 token 轮换、认证心跳滚动续期、移动端单飞恢复 | `m2.integration.test.ts`、移动端会话测试 |
| `SM-014`–`SM-015` | 手动原因规范化、公开投影、独立清除 | `engine.test.ts`、协议契约测试 |
| `SM-016` | `live_audio_cue_id` 与房主 `LIVE` 投影匹配 | `m5-projection.test.ts` |
| `SM-020`–`SM-023` | Redis 最新租约、10 秒截止、PostgreSQL 行锁转换、30 秒投票与 60 分钟索引期限 | `m3-lobby.integration.test.ts`、`connection-service.ts`、`command-service.ts` |
| `FR-016`、`FR-035`–`FR-039` | 固定字幕/正式音频包 | **正式素材门槛阻塞** |
| `FR-040`–`FR-049` | 暂停命令、离线玩家、恢复期限、在线终止投票、不可穿透遮罩、房主不转移、自动返首页 | 引擎/投影/移动测试与 `session-status-layer.tsx` |
| `FR-046`–`FR-047` | 命令 ID 重试、状态版本重同步、本地化错误、维护诊断码 | 命令提交/会话 Provider 测试 |
| `AC-010`–`AC-011` | 普通玩家/房主租约到期暂停并原状态恢复 | 引擎与 Redis 集成测试；原生 E2E 待运行 |
| `AC-012` | `LIVE`/`RESYNC` 播放裁决和新重播 ID | 服务端投影测试；真实播放待素材 |
| `NFR-005`–`NFR-007` | 10 秒服务端截止、30 秒投票/60 分钟 DB 期限、事务/Outbox | 可控时钟测试、集成测试 |
| `NFR-015`、`NFR-021` | 固定资源与系统音频中断 | **正式素材及真机门槛阻塞** |
| `NFR-023`–`NFR-024` | 有限标签第一方计数；离线只读且无命令队列 | 严格遥测 Schema、NetInfo/提交门禁 |

## 3. 数据与秘密边界

- Redis 只保存 `sessionId`、`roomId`、`playerId`、Socket 租约 ID 和服务端截止时间，不保存 token、角色、票或任务行动。
- PostgreSQL 聚合仍是唯一权威；租约 worker 通过房间行锁、状态版本和 Outbox 提交系统转换。
- 音频指标键只包含错误类别、平台、应用版本和语音包版本，不包含房间、玩家、安装标识、cue 内容或 token。
- 客户端不启用 Query 持久化或离线命令队列；断网期间只保留内存中的最后投影并禁用动作。

## 4. 退出证据清单

- 必需自动检查：`format:check`、`lint`、`typecheck`、`test`、`test:contract`、`docs:check`。
- 连接/持久化：服务端集成测试和 `test:load`。
- 2026-08-15 本地负载冒烟：20 房间、146 连接、2,015 次命令确认，零请求/命令错误；投影隔离和公开秘密扫描通过；HTTP 创建/加入、连接和命令确认的 p95 分别为 111.5 ms、277.4 ms、97.6 ms 和 21.9 ms。
- 尚需人工/外部证据：iOS、Android 正常/暂停/字幕降级/最大动态字体截图；真机电话、闹钟、蓝牙中断；正式素材授权记录；30 分钟 1,000 房间/10,000 连接故障场景。

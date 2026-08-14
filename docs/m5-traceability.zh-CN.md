# M5 刺杀、终局与会话清理追踪

本文记录 M5 的实现边界与可复查验收证据。游戏裁决仍唯一位于 `packages/game-engine`；本里程碑新增的服务端逻辑只负责授权投影、终局投递收据与生命周期清理，移动端只提交意图并渲染个性化投影。

## 追踪矩阵

| 交付物 | 规范 | 实现 | 自动化证据 |
| --- | --- | --- | --- |
| `M5-001` 刺杀候选与二次确认 | `RULE-017`–`RULE-018`、`FR-032`–`FR-033`、`UX-014` | 服务端仅向刺客投影 `SelectMerlinTarget`，候选为除本人外全员；移动端专用刺杀页只使用服务器候选，切后台或版本变化清空选择 | `m5-projection.test.ts`、`assassination-state.test.ts`、Maestro M5 流程 |
| `M5-002` 全部终局原因 | `RULE-019`、`FR-034`、`GameOutcome` | 结果状态覆盖三败、五拒、刺杀命中、刺杀未命中和中止；`ABORTED` 使用中性结果 | 游戏引擎规则测试、`result-state.test.ts` |
| `M5-003` 角色揭示与公开历史 | `RULE-019`、`UX-015` | `GAME_OVER` 才公开全员角色/阵营、胜因、刺杀目标、公开投票与匿名任务计数；不公开任务行动归属 | 协议契约测试、`m5-projection.test.ts`、Maestro M5 流程 |
| `M5-004` 终局确认与清理 | `SM-013`、`NFR-016`、`NFR-022`、`TM-009` | 投递前冻结在线会话并建立收据；全部 ACK 后立即级联删除，未完成则 60 秒删除；终局发布后 HTTP 查询和恢复均拒绝；客户端 ACK 后删除 SecureStore token 与私密会话内存，只把结果留在当前进程 | `m2.integration.test.ts`、`dependencies.integration.test.ts`、SecureStore 单测、Maestro M5 流程 |

## 原生视觉与无障碍证据

确定性本地夹具使用模拟昵称和本地证书，不记录或截取会话令牌。

- iOS 默认动态字体：[刺杀确认](verification/m5/ios-assassination-normal.png)、[终局结果](verification/m5/ios-result-normal.png)；
- iOS 较大动态字体：[刺杀确认](verification/m5/ios-assassination-large.png)、[终局结果](verification/m5/ios-result-large.png)。

Maestro 流程同时验证：刺客候选未按阵营过滤、精确二次确认文案、邪恶方刺杀命中结果、刺杀目标、全角色揭示、匿名任务计数、返回首页后的本机会话清理。服务端集成测试进一步验证旧 token、终局恢复和终局查询均不可用，且并发最后 ACK 只触发一次删除。

本轮工作区只有 iOS 26.5 Simulator，没有可用的 `adb`/Android AVD，因此原生 M5 自动化证据仅覆盖 iOS。Android 与 iOS 共用 Expo/React Native 实现并通过相同 TypeScript、状态适配和协议测试，但 Android Development Build 的真实刺杀提交、终局展示和 TalkBack/大字体矩阵仍需在具备 Android SDK、模拟器及测试 CA 信任配置的环境补跑。

## 剩余部署证据

应用层清除已经覆盖 PostgreSQL 房间聚合、玩家、会话、幂等记录、Outbox 和终局收据。`TM-009` 中的数据库 WAL/复制、长期备份以及供应商日志物理残余上限依赖最终部署基础设施，仍须在邀请测试前完成配置和抽检；这些残余不得被解释为产品历史功能。

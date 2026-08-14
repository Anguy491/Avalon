# Avalon 文档索引

本文档集是 `CLASSIC_AVALON_V1` MVP 的产品与工程基线。规则语义、线上协议和实现决策必须通过编号追踪，不以聊天记录或代码中的临时注释替代。

## 产品与规则

- [游戏规则规范](./game-rules.zh-CN.md)：`RULE-001`–`RULE-022`；
- [服务端权威状态机](./server-state-machine.zh-CN.md)：`SM-001`–`SM-021`；
- [移动端 FR/NFR](./mobile-fr-nfr.zh-CN.md)：`FR-001`–`FR-047`、`NFR-001`–`NFR-024`、`AC-001`–`AC-015`；
- [移动端 UX 规范](./ux-spec.zh-CN.md)：页面、交互、隐私和无障碍状态。

## 工程与交付

- [架构总览](./architecture/README.md)与 [ADR 目录](./architecture/README.md#6-决策记录)；
- [HTTP 与实时协议契约](./api-contract.zh-CN.md)和 [Schema 目录](./contracts/README.md)；
- [测试策略](./test-strategy.zh-CN.md)；
- [安全威胁模型](./Avalon-threat-model.md)；
- [MVP 实施路线图](./roadmap.zh-CN.md)；
- [M0 本地开发、配置与验证](./development.zh-CN.md)；
- [M0 本地原生验证证据](./verification/m0/README.md)；
- [M2 会话与房间追踪证据](./m2-traceability.zh-CN.md)；
- [M2 本地原生验证证据](./verification/m2/README.md)；
- [M3 大厅、配置与身份揭示追踪证据](./m3-traceability.zh-CN.md)；
- [M4 组队、投票与任务主循环追踪证据](./m4-traceability.zh-CN.md)；
- [仓库协作规范](../AGENTS.md)。

## 状态

| 文档                     | 状态      | 变更方式                                |
| ------------------------ | --------- | --------------------------------------- |
| 游戏规则、状态机、FR/NFR | MVP 基线  | 产品规则变更，必须同步追踪表与测试      |
| ADR-001–ADR-008          | 已接受    | 新 ADR 取代，不覆盖历史决定             |
| 协议 Schema              | M0 已生成 | 由 `packages/protocol` 导出并做快照校验 |
| UX、测试、安全、Roadmap  | P0 基线   | 随实现发现更新，但不得弱化上游要求      |

## 追踪链

```text
RULE-* → SM-* → API/RT Schema → FR-* / UX-* → AC-* / TEST-* / THREAT-*
```

新增可观察行为时必须能沿该链定位来源；若没有上游需求，应先补充规范再实现。

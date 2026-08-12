# ADR-007：共享 JSON Schema 兼容协议包作为线上契约源

- 状态：已接受
- 日期：2026-08-13

## 背景

当前状态机文档包含 TypeScript 风格类型和 JSON 示例，但客户端、服务器、测试与文档可能各自实现不同字段。协议需要机器可执行、可生成静态类型、可做兼容性检查，同时避免把业务数据库校验混入 Schema。

## 决策

- 线上 JSON 契约遵循 JSON Schema Draft 2020-12；
- P0 的 `docs/contracts/*.schema.json` 是脚手架前的 bootstrap 基线；
- M0 创建 `packages/protocol`，使用 JSON Schema 兼容的 TypeScript schema builder（默认 TypeBox）维护源 Schema，并导出：
  - 运行时验证器；
  - TypeScript 类型；
  - 格式化后的 `docs/contracts/*.schema.json` 快照；
  - 协议示例与兼容性测试夹具；
- M0 后 `docs/contracts` 由脚本生成，CI 若生成结果与 Git 不一致则失败；
- Fastify 在 HTTP 输入和输出边界验证 Schema；Socket.IO 在鉴权后、调用应用服务前验证每个命令；移动端至少在开发/测试验证所有服务端消息，生产对不合法消息进入安全失败和重同步；
- Schema 只校验结构、枚举、长度和基本格式。依赖房间状态、角色、人数表或权限的语义校验继续由游戏引擎/应用服务执行；
- 未声明字段默认拒绝（`additionalProperties=false`）；新可选字段属于向后兼容候选，删除/改义/新增必填字段需要协议主版本升级与 ADR。

## 版本策略

- REST 路径主版本为 `/v1`；
- 实时握手携带整数 `protocolVersion=1`；
- `rulesVersion` 与协议版本独立，MVP 固定 `CLASSIC_AVALON_V1`；
- 客户端低于服务器最低协议版本时返回 `UPGRADE_REQUIRED`，不得尝试降级秘密投影。

## 结果

客户端、服务端、测试和文档共享相同结构定义，PR 能直接看到协议快照变化；Fastify 可使用 Schema 进行验证/序列化。

代价是 Schema 生成链成为构建基础设施，复杂的领域不变量不能仅靠 Schema 表达，仍需明确测试。

## 未采用方案

- 手写 TypeScript interface：运行时不能拒绝非法输入；
- 仅 OpenAPI/AsyncAPI 文档：可能与实际运行时验证漂移；
- 从数据库 ORM 模型生成传输类型：会暴露内部/秘密字段并耦合存储；
- 在客户端复制 Zod Schema：双份定义无法保证一致。

## 验证

- 每个成功和错误示例都通过对应 Schema；
- 缺少必填字段、未知字段、越界数组和非法枚举均被拒绝；
- 生成快照在干净工作区可复现；
- 兼容性测试阻止破坏性 v1 变更；
- 投影 Schema 不包含 SessionToken、任务行动映射或其他玩家私密字段。

## 依据

Fastify 推荐以 JSON Schema 验证路由和序列化输出：[Validation and Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)。Schema 必须视为受信任的应用代码，不得接受用户提供的 Schema。


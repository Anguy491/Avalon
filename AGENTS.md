# Avalon 仓库协作规范

本文件约束在本仓库中工作的自动化代理和工程师。直接用户指令优先于本文；若实现规范互相冲突，不得自行选择会改变游戏裁决或秘密信息边界的解释。

## 1. 规范来源与优先顺序

实现前必须阅读与任务相关的文档。发生冲突时按以下顺序处理：

1. `docs/game-rules.zh-CN.md`：游戏裁决、角色知识和公开信息的产品规则；
2. `docs/server-state-machine.zh-CN.md`：服务端状态、命令、权限、幂等和事务语义；
3. `docs/contracts/*.schema.json` 与 `docs/api-contract.zh-CN.md`：线上协议的字段、传输和兼容性；
4. `docs/mobile-fr-nfr.zh-CN.md`：移动端 FR、NFR 和验收场景；
5. `docs/architecture/ADR-*.md`：已接受的技术决策；
6. `docs/ux-spec.zh-CN.md`、`docs/test-strategy.zh-CN.md`、`docs/Avalon-threat-model.md`：交互、验证和安全约束；
7. `docs/roadmap.zh-CN.md`：实施顺序，不改变前述规范。

同层冲突或无法保持 `RULE-* → SM-* → FR-* → AC-*` 追踪时，停止规则相关实现并报告具体冲突。纯技术细节若不改变对外行为，可选择最小、可逆且有测试覆盖的方案，并记录到 ADR。

## 2. 目标架构与目录职责

初始化后的目标目录为：

```text
apps/mobile/              Expo 移动端；只渲染个性化投影并提交意图
apps/server/              HTTP、Socket.IO、鉴权、持久化和投影分发
packages/game-engine/     纯 TypeScript 状态机；不得依赖网络、数据库或 UI
packages/protocol/        协议 Schema、生成类型和兼容性测试
packages/test-fixtures/   确定性房间、角色和命令夹具；不得含生产秘密
docs/                     产品与工程规范
```

必须维持以下边界：

- 游戏裁决只存在于 `packages/game-engine`，移动端不得复制计票、胜负或角色知识算法；
- `apps/server` 是唯一权威状态持有者；客户端缓存不是裁决依据；
- `packages/protocol` 不依赖 `apps/*`，所有网络输入在进入领域逻辑前完成 Schema 校验；
- 领域事件不得直接广播；服务端先生成 `PublicSnapshot + PrivatePlayerProjection`，再逐连接发送；
- `roleAssignments`、`privateKnowledge`、未公开票和任务行动不得进入公开模型、通用日志或分析事件。

## 3. 工具链约定

- 使用仓库锁定的 Node.js 活跃 LTS、`pnpm` 和 `packageManager` 版本；不得混用 npm、Yarn 或 Bun 锁文件；
- 使用 pnpm workspaces；除非 ADR 另行批准，不引入 Nx 或 Turborepo；
- Expo 原生或 Expo 生态依赖必须在 `apps/mobile` 中通过 `npx expo install <package>` 安装；
- 纯 JavaScript/TypeScript 依赖使用 `pnpm --filter <workspace> add`；
- 精确版本由 `package.json`、Expo 配置和 `pnpm-lock.yaml` 记录，文档只记录版本策略；
- 禁止手工修改生成文件。Schema 导出、类型生成或代码格式化必须通过仓库脚本完成。

项目尚未初始化时，只有明确包含“M0/初始化/脚手架”的任务才可创建应用和依赖文件。

## 4. 必需命令

M0 完成后，根 `package.json` 必须提供以下脚本，且代理在相关改动后执行：

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contract
pnpm test:e2e:mobile
pnpm test:load
pnpm docs:check
```

- 普通代码改动至少运行 `format:check`、`lint`、`typecheck` 和受影响测试；
- 协议、状态机或秘密投影改动必须额外运行 `test:contract`；
- 核心移动流程改动必须运行相关原生 E2E；不能在当前环境运行时，必须说明缺失的设备/凭证和仍未验证的范围；
- 性能架构、广播或持久化改动必须运行目标负载场景；
- 文档、Schema 或追踪编号改动必须运行 `docs:check`。

不得通过删除、跳过或放宽测试来让检查通过。确有规范变更时，必须同步实现、测试、Schema 和文档。

## 5. 实现规则

- TypeScript 开启严格模式；不得以无说明的 `any` 绕过协议或领域类型；
- 使用显式、稳定的枚举值和错误码；面向用户的中文文案不得作为程序分支条件；
- 所有改变房间的命令携带 `commandId` 与 `expectedStateVersion`；自动裁决与最后一次提交处于同一事务；
- 随机发牌和首位队长必须使用可注入的 CSPRNG 端口；测试使用固定种子或固定排列，生产不得使用测试随机源；
- 时间、随机数、ID、持久化和消息发布通过端口注入，保持游戏引擎确定性；
- 昵称等用户输入在边界校验和输出编码，不进入音频键、日志模板或代码执行上下文；
- 不在客户端持久化他人的私密投影；本人令牌只进入平台安全存储；
- UI 必须展示服务端错误的本地化映射，不显示堆栈、内部主键或原始秘密载荷。

## 6. 测试与证据

每项变更的验收证据必须对应需求编号：

- 规则测试使用 `RULE-*` / `SM-*`；
- 移动端行为使用 `FR-*` / `AC-*`；
- 非功能验证使用 `NFR-*`；
- 安全测试使用 `THREAT-*`；
- Issue 和 PR 描述必须列出本次覆盖与不覆盖的编号。

涉及 UI 的完成证据应包含至少一个正常状态和相关异常/无障碍状态的模拟器截图或录屏。截图不得包含可复用的真实会话令牌。

## 7. 完成定义

任务只有同时满足以下条件才算完成：

1. 验收条件可观察且已通过；
2. 实现未突破包边界或秘密信息边界；
3. 必需检查通过，或清楚记录因外部条件未运行的检查；
4. Schema、示例、追踪表和实现保持一致；
5. 新决策已记录为 ADR，新风险已进入安全文档；
6. UI 变更具有视觉与无障碍证据；
7. 没有把生产秘密、个人数据或角色秘密写入仓库和日志。

## 8. 自主执行与人工门槛

在已批准目标范围内，可以自主进行可逆的代码、测试、文档、免费依赖和本地数据库变更，不需要为常规实现步骤反复请求确认。

出现以下情况必须停止并请求用户决定：

- 规则、胜负、角色知识、隐私保留期或 MVP 范围存在冲突；
- 需要付费服务、生产账号、生产密钥、证书或 App Store/Play Console 操作；
- 需要生产部署、公开发布、商店提交或向外部用户发送消息；
- 需要破坏性迁移、删除共享/生产数据或不可逆基础设施变更；
- 需要采集新的个人数据、设备标识、分析字段或第三方 SDK 数据；
- 需要使用、购买或发布权属不明确的名称、美术、字体、音乐或语音。

## 9. Git 与任务跟踪

- GitHub Issues/Project 是实时任务状态的唯一权威；`docs/roadmap.zh-CN.md` 只记录里程碑和门槛；
- 一个 Issue 应形成一个可审查的纵向增量；共享 Schema 变更先合并，再并行开发消费者；
- 保留工作区中不属于当前任务的改动，不做破坏性重置；
- 提交、推送、创建 PR、合并或部署仅在当前目标明确授权时执行；
- PR 标题/描述包含里程碑、追踪编号、测试结果和剩余风险。

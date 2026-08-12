# ADR-001：TypeScript + pnpm workspace 单仓库

- 状态：已接受
- 日期：2026-08-13
- 决策者：项目所有者；实施代理按本文执行

## 背景

移动端、服务器、权威游戏引擎和协议需要共享稳定枚举与测试夹具。拆分仓库会增加跨仓库版本发布和协议漂移风险；单一应用仓库又会使秘密投影和领域边界难以验证。

## 决策

采用一个 Git 仓库和 pnpm workspaces，所有运行时代码使用严格 TypeScript：

```text
apps/mobile
apps/server
packages/game-engine
packages/protocol
packages/test-fixtures
```

- 根目录锁定 `packageManager` 与 Node.js 活跃 LTS；
- 初期只使用 pnpm 的 workspace/filter 脚本，不引入 Nx/Turborepo；
- Expo 采用官方 monorepo 自动配置，不手写 `watchFolders` 等旧式 Metro 解析；
- 每个 workspace 明确声明直接依赖，不依赖偶然 hoist；
- 应用只依赖包的公开入口，禁止通过相对路径穿透其他 workspace 源文件。

## 结果

优点：协议和引擎改动可原子提交；CI 可做跨包类型检查；Codex 能在一个 Issue 中完成纵向切片；测试夹具可共享。

代价：移动 Metro、Node ESM 和 pnpm 解析必须在 M0 一次配置正确；工作区根命令需要明确过滤范围。

## 未采用方案

- 多仓库：协议版本协调成本高，不适合 MVP；
- 单个 Expo 项目内附服务器：边界和部署生命周期不清晰；
- Nx/Turborepo：首版任务量不足以抵消额外配置，出现实际 CI 性能瓶颈后再 ADR。

## 验证

- 根安装只产生一个 `pnpm-lock.yaml`；
- `pnpm typecheck` 覆盖全部 workspace；
- 依赖边界测试证明 `game-engine` 不依赖应用或 I/O 包；
- Expo 在 iOS、Android 与 web 开发入口均能解析 workspace 包。


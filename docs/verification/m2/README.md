# M2 本地验证证据

> 日期：2026-08-13（Australia/Sydney）
>
> 范围：`M2-001`–`M2-006`、`SM-001`–`SM-003`、`AC-009`、`AC-013`、`NFR-006`–`NFR-007`、`NFR-010`、`NFR-013`

## 原生用户流程

本目录记录 iOS Development Build 的正常大厅、无效房间号和相机拒绝降级状态。测试只使用合成昵称和本地临时房间；UI、截图与 Maestro 输出不包含 SessionToken、角色、私密知识或可复用生产凭证。

原生构建使用 Xcode 26.6 与 iOS Simulator。仓库位于 File Provider 同步目录，故按已有 M0 验证方法把同一未提交工作树复制到同步范围外的临时目录构建；未修改依赖、Pods 或生成 Framework 绕过 codesign。

最终 Node/pnpm 门槛也在同一份 `rsync` 精确源码镜像中执行：验证后重新对原工作树运行 `git status`、`git diff --check` 并确认 `main`/`981ca2d` 未变。原因是验证后段 File Provider 对原目录的 Node 文件读取持续阻塞；这不改变命令、锁文件、工具链版本或测试输入。

Development Build 在专用 iOS 26.1 模拟器上以 Xcode `Sign to Run Locally` ad-hoc 签名，因此 SecureStore 走真实 Keychain。Maestro 套件开始前精确重置该测试模拟器 Keychain，避免 iOS 按设计跨卸载保留的旧测试会话影响匿名首屏；没有读取、导出或记录 Keychain 内容。

| 状态 | 证据 | 对应验收 |
| --- | --- | --- |
| 正常创建至 6 人房大厅 | [ios-lobby.png](./ios-lobby.png) | `FR-001`、`FR-002`、`FR-005`、`AC-013` |
| 正常加入预置房并显示房主与加入者 | [ios-join-lobby.png](./ios-join-lobby.png) | `FR-003`、`FR-005`、`AC-013` |
| 五位房间号即时拒绝且不触网 | [ios-invalid-room.png](./ios-invalid-room.png) | `FR-003`、`UX-003`、`TM-004` |
| 相机拒绝后保留手输入口 | [ios-camera-denied.png](./ios-camera-denied.png) | `FR-004`、`FR-046`、`UX-004` |
| 暗色与最大动态字体、滚动根容器 | [ios-dark-max-dynamic-type.png](./ios-dark-max-dynamic-type.png) | `NFR-008`、`NFR-009`、`NFR-014` |

Maestro 使用可访问名称、角色和稳定 `testID` 驱动输入与按钮；仓库必需的两条流程合计验证 44×44 以上触控入口、错误 live region、相机权限说明及拒权回退；额外的 `m2-c-join-room.yaml` 以本地 API 预置的合成房间号验证设备侧正常加入和两名玩家列表。最大动态字体截图使用模拟器 `accessibility-extra-extra-extra-large`，验收后恢复系统 `large` 与亮色外观。

## 自动化层

- 协议：创建/加入 `installationId` 兼容、未知字段拒绝、HTTP/Socket 完整 Schema；
- 单元：昵称/房间号/QR、SecureStore 轮换崩溃、幂等键和 RoomView 版本单调性；
- 集成：迁移、PostgreSQL 行锁、会话轮换、ack/Outbox 故障点、Redis、多实例 Socket 与终局级联清除；
- 原生 E2E：正常创建到大厅、无效房间号、相机拒绝和手输替代；
- 负载冒烟：20 个并发 10 人房（20 次创建 + 180 次加入），HTTP 错误为零并检查创建/加入 p95 不超过 2 秒。此项不替代 M7 `NFR-004` 发布容量测试。

最终负载实测：创建 p50 `39.1 ms`、p95 `53.1 ms`、p99 `53.3 ms`；加入 p50 `246.2 ms`、p95 `394.8 ms`、p99 `408.0 ms`。原生顺序命令 `pnpm test:e2e:mobile` 的两个 Maestro flow 均通过；开发客户端链接首次打开时的可选 `Wait`/URL 动作未出现并按预期记为 warned，不影响产品断言。

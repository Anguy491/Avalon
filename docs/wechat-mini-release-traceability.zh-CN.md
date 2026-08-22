# 微信小程序发布候选追踪与证据

> 日期：2026-08-20
>
> 范围：只构建和验证发布候选；不上传、提审、部署或公开发布。

## 实现追踪

| 增量 | 需求/风险 | 实现证据 | 自动验证 | 人工/外部门槛 |
| --- | --- | --- | --- | --- |
| 私密交互与缺失验收 | `FR-003`、`FR-011`、`FR-017`–`FR-034`、`FR-040`–`FR-050`、`AC-014`、`AC-018`、`TM-010` | 微信身份按住揭示、私密投票/任务/终止层、暂停遮罩、刺杀攻略、完整投票/任务历史、全屏 QR、开始禁用原因、配置远程校验和完整错误映射 | 微信 reducer/页面单元测试、typecheck、构建、开发者工具 E2E | 最大字体/读屏、后台预览及完整多设备真机证据 |
| 微信身份绑定 | `FR-006`、`NFR-010`、`NFR-017`、`AC-019`、`TM-002` | `POST /v2/auth/wechat`、身份 HMAC/Redis TTL、SessionContext 双因子、数据库主体唯一索引、客户端内存缓存/单次重试、[ADR-012](./architecture/ADR-012-wechat-login-session-binding.md) | 协议、code2Session 单元、API/DB/实时集成、安全扫描 | 生产微信上游、秘密存储、transition 清零与两个微信账号真机测试 |
| 音频公开候选 | `FR-035`–`FR-039`、`NFR-015`、`NFR-018`、`NFR-021`、`AC-012` | [权利记录](./assets/audio-zh-CN-v1-rights.zh-CN.md)、单一 manifest 生成 Expo/微信映射、SHA-256/字幕校验、房主控制、中断不重播、字幕降级 | `audio:verify`、微信音频单元、release 构建、包体检查 | 低端 Android/iPhone 音量、来电/后台中断和字幕可读性 |
| 依赖与发布构建 | `NFR-012`、`TM-008`、发布门槛 | Swiper `12.1.2` 精确 override、critical 审计、[high 风险登记](./dependency-risk-register.zh-CN.md)、`.swc` 清理、固定 AppID、严格 release 配置校验和 CI 门禁 | `audit:prod:critical`、`build:weapp:release`、`test:size:weapp`、`secret:scan` | 合法域名/生产配置、微信开发者权限及任何上传/提审/发布均需另行授权 |

## 发布阻塞判定

- 任一 production critical 依赖告警、音频 manifest/hash/权利失败、发布配置含非 HTTPS/localhost/IP/`.invalid`、包体超限或身份模式不是 `required`，均阻塞发布候选；
- build-time high 只可在不进入发布产物、依赖路径和复核日期有书面证据时暂时接受；critical 不允许豁免；
- 自动测试通过不替代 `AC-014`、`AC-019` 的微信真机证据；
- 本文不授予生产部署、微信代码上传、审核或公开发布权限。

## 本地自动证据（2026-08-20）

- `format:check`、`lint`、`typecheck`、全仓 `build`、`test`、73 项 `test:contract`、`test:security`、`docs:check`、`secret:scan`、`audio:verify` 和 production critical audit 通过；审计剩余 2 个 build-time high 已登记且无 critical；
- PostgreSQL/Redis 容器集成 37 项通过，覆盖迁移回滚、微信 HTTP/Socket 双因子、错身份、同房唯一座位、跨房允许、原生兼容和 SessionToken 轮换；
- 严格 release profile 构建通过，最终产物不含开发 API/join fallback；包体 `main=940412`、`room=35700`、`game=32397`、`total=1008509` 字节；
- 微信开发者工具首页 E2E 通过；本地 20 房间/146 连接/2015 命令负载为零错误，投影隔离与公开秘密扫描通过，p95：创建 117.8ms、加入 208.1ms、连接 72.7ms、命令 19.5ms；
- 未运行：`test:e2e:weapp:preview`（没有已授权 HTTPS Preview 地址）、`test:load:release`（要求隔离环境中 1000 房间、30 分钟稳态），以及两个微信账号、低端 Android、iPhone、最大字体和读屏真机矩阵。这些项目继续阻塞实际上传/提审授权。

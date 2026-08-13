# 协议 Schema 目录

本目录保存协议 v1 的生成 JSON Schema，使用 JSON Schema Draft 2020-12。它们与 [API/实时协议契约](../api-contract.zh-CN.md)共同定义线上结构，领域语义仍以[服务端状态机](../server-state-machine.zh-CN.md)为准。

| 文件                      | 内容                                    |
| ------------------------- | --------------------------------------- |
| `common.schema.json`      | 标识、枚举和通用值对象                  |
| `room-config.schema.json` | 建房输入与规范化房间配置                |
| `command.schema.json`     | `SM-004`–`SM-019` 的实时命令联合类型    |
| `room-view.schema.json`   | 公开快照、本人私密投影和个性化房间视图  |
| `error.schema.json`       | 稳定错误响应                            |
| `http.schema.json`        | 创建、加入、恢复和读取投影的请求/响应体 |
| `transport.schema.json`   | Socket.IO 握手、命令结果和房间投影信封  |

## 权威关系

- `packages/protocol` 的 TypeBox Schema 是编辑源，本目录由 `pnpm protocol:generate` 导出；
- `pnpm test:contract` 验证正反例；`pnpm docs:check` 验证导出快照和引用；
- 禁止从数据库模型生成这些 Schema，也禁止向 Schema 添加服务器内部或其他玩家秘密字段。

## Schema 不能替代的校验

下列约束必须由应用服务/游戏引擎检查：角色阵营数量、当前阶段、操作者权限、队伍人数表、善方不能失败、重复提交、状态版本、五次否决、两失败阈值、刺杀目标与全部投影知识矩阵。

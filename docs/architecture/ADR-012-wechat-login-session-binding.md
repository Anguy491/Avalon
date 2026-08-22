# ADR-012：`wx.login + SessionToken` 微信会话双因子绑定

- 状态：已接受
- 日期：2026-08-20

## 背景

微信小程序没有应用可控的 Keychain/Keystore 等价物。仅把 SessionToken 写入微信沙箱时，复制该 token 的同平台攻击者可能恢复座位、读取本人投影或提交不可逆动作。微信登录能够提供同一小程序内稳定的 OpenID，但微信身份不得代替游戏会话，也不得成为裁决依据。

## 决策

- 小程序通过 `wx.login` 取得一次性 code，并立即调用 `POST /v2/auth/wechat`；code 只由服务端提交给微信 `code2Session`，不复用、不写入日志；
- 服务端不保存或返回原始 OpenID、UnionID 或 `session_key`。OpenID 立即使用生产身份 pepper 做 HMAC，数据库只保存该摘要；AppSecret、pepper 与 `session_key` 不进入客户端或仓库；
- 身份交换返回 256 位随机、不透明的 `wechatIdentityToken`。Redis 只保存令牌摘要到微信主体摘要的映射，固定 TTL 为 5 分钟；小程序仅在内存保存身份令牌；
- 微信会话的创建、加入、恢复、读取投影和 Socket.IO 握手必须同时匹配 SessionToken 绑定及微信身份。身份过期时，小程序重新执行 `wx.login`，以原幂等键最多重试一次；
- 微信身份凭证不能单独恢复座位，不提供无 SessionToken 找回。SessionToken 继续采用 30 分钟滑动 TTL、恢复原子轮换和旧 token 撤销；
- 同一 `(room_id, wechat_subject_digest)` 只能存在一个座位；同一微信账号可加入不同房间。SessionToken 轮换不改变绑定主体；
- iOS/Android 原生客户端不要求微信身份，继续使用协议 v2；
- 服务端先以 `transition` 模式允许既有微信会话在恢复时补写平台和主体。确认 legacy 活跃会话为零后切换 `required`；公开发布只允许 `required`；
- 微信身份标识仅用于保护当前游戏会话，保留到房间清理；不调用用户资料接口，不收集微信昵称或头像。

## 结果与权衡

被复制的 SessionToken 在另一个微信账号上不能使用；同时，本机丢失 SessionToken 仍无法找回座位。这避免把微信账号提升为恢复主凭证，也不改变游戏裁决。代价是身份交换依赖微信上游和 Redis，因此需要稳定错误码、严格限流与字幕/界面的可恢复提示。

## 验证

- 契约验证身份令牌只出现在微信认证响应、请求头和实时 auth，不进入 `RoomView`；
- 服务端覆盖 code2Session 成功、无效、超时、限流、日志脱敏、过期/错误身份、错账号、同房重复座位、跨房允许和原生兼容；
- 微信端覆盖内存缓存、过期刷新、同幂等键单次重试和本地存储无身份令牌；
- `AC-019` 以两个微信账号验证复制 SessionToken 不能恢复、读取或连接；
- 真机验收前检查生产 `WECHAT_APP_ID` 与 `wx0240d55d0f3e4811` 一致，并确认 AppSecret/pepper 只存在于生产秘密存储。

## 参考

- [微信登录流程](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html)
- [code2Session](https://developers.weixin.qq.com/miniprogram/dev/server/API/user-login/api_code2session.html)

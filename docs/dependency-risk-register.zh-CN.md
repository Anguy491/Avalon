# 依赖风险登记

复核日期：2026-08-20。下次最晚复核：2026-09-20，或 Expo/Metro 发布兼容修复版本时提前复核。

| 严重度 | 依赖与公告 | 当前路径 | 可利用性判断 | 处置 |
| --- | --- | --- | --- | --- |
| critical（已消除） | `swiper` / `GHSA-hmx5-qpq5-p643` | `@tarojs/components@4.2.1 → swiper` | 小程序发布依赖路径；不得豁免 | workspace 精确 override 到 `12.1.2`；`pnpm audit --prod --audit-level critical` 为 CI 硬门槛 |
| high（限期复核） | `image-size@1.2.1` / `GHSA-w3rx-r6r6-pgpr`、`GHSA-5p2g-fcmc-qvqq` | Expo/React Native → Metro → `image-size` | 仅构建时解析仓库内受审资源，不进入 iOS、Android 或微信运行产物；攻击前提是恶意资源已进入受信构建输入 | 不跨 Expo/Metro 大版本强制覆盖；保持代码评审与固定锁文件，最迟 2026-09-20 复核兼容修复 |

任何新增 critical 告警均阻断发布。High 只有在确认不进入发布运行产物、记录完整依赖路径和复核期限后才可临时保留。

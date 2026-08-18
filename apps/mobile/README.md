# Avalon Mobile

M0 Expo Router / CNG 移动端骨架。应用只负责渲染服务端个性化投影并提交意图；游戏裁决、计票与角色知识算法不得放入本 workspace。

从仓库根目录安装依赖后运行：

```bash
pnpm --filter @avalon/mobile dev
pnpm --filter @avalon/mobile ios
pnpm --filter @avalon/mobile android
```

`ios`/`android` 使用包含 `expo-dev-client` 的本地 Development Build。`apps/mobile/ios` 与 `apps/mobile/android` 由 CNG 生成且不提交；配置应修改 `app.config.ts` 或 Expo config plugin，不能手工维护原生目录。

已确定的稳定应用标识为：应用名“曼波阿瓦隆”、Expo slug `anguy-avalon`、URL scheme `anguyavalon`，iOS Bundle ID 和 Android Application ID 均为 `dev.anguy.avalon`。完整环境、EAS profile 和验证说明见仓库根目录的 `docs/development.zh-CN.md`。

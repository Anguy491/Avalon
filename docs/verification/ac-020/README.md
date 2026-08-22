# AC-020 Expo 英文本地化验证

- 日期：2026-08-22
- 设备：iPhone 17 Pro 模拟器，iOS 26.5
- 系统语言：`en_US`
- 命令：`pnpm --filter @avalon/mobile test:e2e:localization`
- 结果：默认字号与 `accessibility-extra-extra-extra-large` 均通过英文首页、昵称输入、加入房间、房间号错误、相机拒绝和房间号回退流程。

## 截图

- [英文首页（默认字号）](ios-english-home.png)
- [英文相机拒绝状态（默认字号）](ios-english-camera-denied.png)
- [英文首页（最大无障碍字号）](ios-english-max-text-home.png)
- [英文相机拒绝状态（最大无障碍字号）](ios-english-max-text-camera-denied.png)
- [前台切换为中文后保留当前页面](ios-foreground-switch-zh.png)
- [前台切回英文后保留当前页面](ios-foreground-switch-en.png)

前台切换截图通过修改 iOS 单 App `AppleLanguages` 后将同一运行中应用从系统设置带回前台获得；相机拒绝状态和扫描页导航均未被重建。截图仅含模拟数据，不含会话令牌或角色秘密。当前机器未安装 Android SDK/`adb`，Android `en_US` 冒烟仍需在具备 Android 模拟器的环境补跑。

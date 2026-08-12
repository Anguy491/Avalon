# ADR-005：Expo Router、CNG 与分阶段原生交付

- 状态：已接受
- 日期：2026-08-13

## 背景

移动端需要 iOS/Android、深链接扫码、相机、安全存储、本地固定音频、系统音频中断处理和无障碍。项目希望在快速 UI 迭代的同时保持可复现原生构建，并避免长期手工维护 `ios/`、`android/`。

## 决策

- 使用 Expo 默认 TypeScript 模板和 Expo Router 的 `src/app` 文件路由；
- 在 M0 显式选择当时可用于生产且与测试设备/Expo Go 兼容的稳定 Expo SDK，以模板参数、`package.json` 和锁文件固定；不得依赖 `latest` 的隐式 SDK；
- 使用 Expo Continuous Native Generation（CNG）；MVP 不提交手工维护的 `ios/`、`android/`，原生配置通过 app config/config plugin 表达；
- M0 用 Expo Go 完成基础导航与布局回路；不晚于 M2 建立 `expo-dev-client` Development Build，随后原生 E2E 和预发布均以开发/预览构建为准；
- Expo 兼容依赖使用 `npx expo install`；每次 SDK 升级单独 Issue，先运行 Expo doctor、原生构建和回归；
- EAS 建立 `development`、`preview`、`production` 三个 profile。OTA 更新只发布与原生 runtime version 兼容的 JavaScript/资源变更；
- iOS/Android bundle identifier、Expo/EAS 项目归属、商店账号和生产签名属于人工门槛。

## 路由约定

公开加入链接使用受控 HTTPS universal/app link 并只携带房间号。路由组至少包含：

```text
src/app/(public)/
src/app/(room)/
src/app/(game)/
src/app/+not-found.tsx
```

实际页面 ID 与层级以 `docs/ux-spec.zh-CN.md` 为准。身份页、任务选择和刺杀页不得生成可被外部深链直接打开并绕过投影权限的路由状态。

## 结果

Expo Router 提供统一深链和多平台导航；CNG 让原生配置可审查、可重建；Development Build 能覆盖生产级原生行为。

代价是 SDK/Expo Go 过渡期需要显式选择版本，原生依赖变化需重新构建开发客户端，EAS 与商店发布需要外部账号和人工审批。

## 未采用方案

- 裸 React Native：原生维护负担高于 MVP 所需；
- 永久只用 Expo Go：无法作为生产级原生集成和分发验证环境；
- 首日提交原生目录：容易产生不可重复的手工修改；
- 运行时 TTS：与固定中文音频、字幕版本和隐私要求冲突。

## 验证

- iOS/Android Development Build 能完成扫码、SecureStore、音频打断和深链；
- 从干净 checkout 可仅凭配置重建原生工程；
- `preview` 构建通过 `AC-001`–`AC-015`；
- OTA runtime 不兼容时客户端不会加载错误更新；
- Expo Go 不再作为 M2 后原生验收证据。

## 依据

- [Expo Router introduction](https://docs.expo.dev/router/introduction/)
- [Expo monorepo guide](https://docs.expo.dev/guides/monorepos/)
- [Switch from Expo Go to a development build](https://docs.expo.dev/develop/development-builds/expo-go-to-dev-build/)
- [EAS Build with monorepos](https://docs.expo.dev/build-reference/build-with-monorepos/)


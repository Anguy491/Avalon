import { defineConfig, type UserConfigExport } from '@tarojs/cli';
import path from 'node:path';

export default defineConfig((merge) => {
  const release = process.env.TARO_APP_BUILD_PROFILE === 'release';
  if (
    release &&
    (process.env.TARO_APP_API_URL === undefined ||
      process.env.TARO_APP_JOIN_HOST === undefined ||
      process.env.TARO_APP_VERSION === undefined)
  ) {
    throw new Error(
      'Release profile requires API URL, join host, and version.',
    );
  }
  const base: UserConfigExport = {
    projectName: 'avalon-wechat-mini',
    date: '2026-08-19',
    designWidth: 375,
    deviceRatio: { 375: 2 },
    sourceRoot: 'src',
    outputRoot: 'dist',
    framework: 'react',
    compiler: 'webpack5',
    defineConstants: {
      'process.env.TARO_APP_API_URL': JSON.stringify(
        process.env.TARO_APP_API_URL ?? 'http://127.0.0.1:3000',
      ),
      'process.env.TARO_APP_JOIN_HOST': JSON.stringify(
        process.env.TARO_APP_JOIN_HOST ?? 'join.example.invalid',
      ),
      'process.env.TARO_APP_VERSION': JSON.stringify(
        process.env.TARO_APP_VERSION ?? '0.1.0',
      ),
      'process.env.TARO_APP_BUILD_PROFILE': JSON.stringify(
        process.env.TARO_APP_BUILD_PROFILE ?? 'development',
      ),
    },
    alias: {
      '@': path.resolve(__dirname, '..', 'src'),
    },
    copy: {
      patterns: [
        {
          from: path.resolve(
            __dirname,
            '..',
            '..',
            'mobile',
            'assets',
            'audio',
            'zh-CN-v1',
          ),
          to: path.resolve(
            __dirname,
            '..',
            'dist',
            'assets',
            'audio',
            'zh-CN-v1',
          ),
        },
      ],
      options: {},
    },
    cache: { enable: true },
    mini: {
      optimizeMainPackage: { enable: true },
      postcss: {
        pxtransform: { enable: true, config: {} },
        url: { enable: true, config: { limit: 1024 } },
        cssModules: {
          enable: false,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
    },
  };
  return process.env.NODE_ENV === 'development'
    ? merge({}, base, { mini: { debugReact: true } })
    : merge({}, base, { mini: { debugReact: false } });
});

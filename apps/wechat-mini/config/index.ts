import { defineConfig, type UserConfigExport } from '@tarojs/cli';
import path from 'node:path';

export default defineConfig((merge) => {
  const base: UserConfigExport = {
    projectName: 'avalon-wechat-mini',
    date: '2026-08-19',
    designWidth: 375,
    deviceRatio: { 375: 2 },
    sourceRoot: 'src',
    outputRoot: 'dist',
    framework: 'react',
    compiler: 'webpack5',
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

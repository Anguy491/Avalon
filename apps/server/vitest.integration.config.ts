import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@avalon/game-engine': new URL(
        '../../packages/game-engine/src/index.ts',
        import.meta.url,
      ).pathname,
      '@avalon/protocol': new URL(
        '../../packages/protocol/src/index.ts',
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    fileParallelism: false,
    hookTimeout: 120_000,
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 120_000,
  },
});

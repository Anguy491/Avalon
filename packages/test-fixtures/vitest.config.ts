import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@avalon/game-engine': new URL(
        '../game-engine/src/index.ts',
        import.meta.url,
      ).pathname,
      '@avalon/protocol': new URL('../protocol/src/index.ts', import.meta.url)
        .pathname,
    },
  },
  test: {
    passWithNoTests: false,
  },
});

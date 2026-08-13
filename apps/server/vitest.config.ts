import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@avalon/protocol': new URL(
        '../../packages/protocol/src/index.ts',
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    passWithNoTests: false,
  },
});

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve the core workspace package from source so daemon tests run without a prior build.
export default defineConfig({
  resolve: {
    alias: {
      '@comment-everything/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['test/**/*.test.ts'], testTimeout: 15_000 },
});

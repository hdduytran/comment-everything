import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'jsdom' },
  resolve: {
    alias: {
      '@comment-everything/core/browser': fileURLToPath(
        new URL('../core/src/browser.ts', import.meta.url),
      ),
    },
  },
});

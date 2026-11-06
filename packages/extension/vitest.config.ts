import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
  resolve: {
    alias: {
      '@comment-everything/core/browser': src('../core/src/browser.ts'),
      '@comment-everything/overlay': src('../overlay/src/index.ts'),
    },
  },
});

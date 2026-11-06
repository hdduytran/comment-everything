import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (pkg: string) => fileURLToPath(new URL(`../${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@comment-everything/core': src('core'),
      '@comment-everything/daemon': src('daemon'),
    },
  },
  test: { include: ['test/**/*.test.ts'], testTimeout: 30_000 },
});

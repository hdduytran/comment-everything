import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  clean: true,
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  // Workspace packages are bundled in so the published CLI is self-contained;
  // third-party deps stay external and are declared in package.json.
  noExternal: [/^@comment-everything\//],
});

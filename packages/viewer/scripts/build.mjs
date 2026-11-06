// Bundles the viewer app (ESM, code-split so mermaid loads lazily) and the frame agent (classic
// script, loaded inside the sandboxed iframe) into the output folder the daemon serves at /_ce/.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const shared = {
  absWorkingDir: root,
  bundle: true,
  minify: true,
  target: 'es2022',
  platform: 'browser',
  tsconfig: path.join(root, 'tsconfig.json'),
  legalComments: 'none',
  logLevel: 'warning',
};

await build({
  ...shared,
  entryPoints: ['src/viewer-main.ts'],
  format: 'esm',
  splitting: true,
  outdir: out,
  chunkNames: 'chunk-[hash]',
});
await build({
  ...shared,
  entryPoints: { 'frame-agent': 'src/frame-agent.ts' },
  format: 'iife',
  outdir: out,
});
cpSync(path.join(root, 'src', 'viewer.css'), path.join(out, 'viewer.css'));

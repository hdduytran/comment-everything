// Bundles the service worker and the injected content script (overlay included) and assembles the
// unpacked extension folder: load packages/extension/dist via chrome://extensions > Load unpacked.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: {
    'background-service-worker': 'src/background-service-worker.ts',
    // Classic script: it is injected with chrome.scripting.executeScript, not as a module.
    'content-overlay-injector': 'src/content-overlay-injector.ts',
    // Registered at document_start for opted-in origins (classic script as well).
    'early-event-shield': 'src/early-event-shield.ts',
    'options-page': 'src/options-page.ts',
  },
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'chrome116',
  platform: 'browser',
  tsconfig: path.join(root, 'tsconfig.json'),
  legalComments: 'none',
  logLevel: 'warning',
  outdir: out,
});
cpSync(path.join(root, 'src', 'options-page.html'), path.join(out, 'options-page.html'));
cpSync(path.join(root, 'manifest.json'), path.join(out, 'manifest.json'));
cpSync(path.join(root, 'icons'), path.join(out, 'icons'), { recursive: true });

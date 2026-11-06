// Ships the viewer bundle inside the CLI package (<cli build>/viewer) so `npx comment-everything`
// is self-contained; the bundled daemon finds it next to cli.js.
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, '..', 'viewer', 'dist');
const target = path.join(root, 'dist', 'viewer');

if (!existsSync(path.join(source, 'viewer-main.js'))) {
  throw new Error('Viewer bundle not found; build @comment-everything/viewer first');
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });

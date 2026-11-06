import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';
import { VIEWER_ASSET_PREFIX } from './viewer-page.js';
import { ScopeError, resolveScopedPath, serveFile } from './scoped-file-server.js';

/** Only flat, plain file names are served from the viewer bundle directory. */
const ASSET_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Locate the built viewer bundle: next to the running module (published CLI layout) or in the
 * sibling `viewer` workspace package (monorepo checkout). Returns undefined when not built.
 */
export function defaultViewerDir(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, 'viewer'),
    path.join(here, '..', '..', 'viewer', 'dist'),
    path.join(here, '..', '..', '..', 'viewer', 'dist'),
  ];
  return candidates.find((dir) => existsSync(path.join(dir, 'viewer-main.js')));
}

/**
 * Serve the viewer bundle at `/_ce/<name>`. Public (no token): the files are static code that
 * contains no secrets, and the sandboxed frame agent must be loadable without credentials.
 */
export function mountViewerAssets(app: Hono, viewerDir: string | undefined): void {
  app.get(`${VIEWER_ASSET_PREFIX}:name`, async (c) => {
    const name = c.req.param('name');
    if (!viewerDir || !ASSET_NAME.test(name) || name.startsWith('.')) {
      return c.json({ error: 'not_found' }, 404);
    }
    try {
      const file = await resolveScopedPath(await realpath(viewerDir), name);
      const res = await serveFile(file, { sandboxHtml: false });
      res.headers.set('Cache-Control', 'no-cache');
      return res;
    } catch (err) {
      if (err instanceof ScopeError) return c.json({ error: 'not_found' }, 404);
      throw err;
    }
  });
}

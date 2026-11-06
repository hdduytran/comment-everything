import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { ZodError } from 'zod';
import {
  hostGuard,
  originGuard,
  tokenGuard,
  type GuardConfig,
} from './auth-token-and-origin-guard.js';
import { mountEventsRoute, type CommentEventBus } from './comment-events-sse.js';
import { ValidationError, type CommentService } from './comment-service.js';
import type { JobQueue } from './job-queue.js';
import { mountMcpHttpEndpoint } from './mcp-http-endpoint.js';
import type { ProjectRootRegistry } from './project-root-registry.js';
import { mountRestRoutes } from './rest-comment-routes.js';
import { ScopeError, resolveScopedPath, serveFile } from './scoped-file-server.js';
import type { FileChangeWatcher } from './file-change-watcher.js';
import { VIEWER_ASSET_PREFIX, VIEWER_CSP, renderViewerPage } from './viewer-page.js';
import { mountViewerAssets } from './viewer-assets-route.js';

export interface AppDeps extends GuardConfig {
  service: CommentService;
  registry: ProjectRootRegistry;
  bus: CommentEventBus;
  jobs: JobQueue;
  version: string;
  /** Serve project HTML/SVG with a CSP sandbox (default true). */
  sandboxHtml?: boolean;
  /** Directory holding the built viewer bundle; `/_ce/*` is 404 without it. */
  viewerDir?: string;
  /** Publishes `file.changed` for files opened in the viewer. */
  fileWatcher?: FileChangeWatcher;
}

/** Query flag set by the viewer on its iframe so the daemon splices the frame agent into HTML. */
export const FRAME_AGENT_FLAG = 'ce-frame';
export const FRAME_AGENT_FILE = 'frame-agent.js';

/** Assemble the Hono app: guards -> routes. Pure (no listening), so tests can call `app.request`. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use('*', hostGuard(deps));
  app.use('*', originGuard(deps));
  app.use('*', tokenGuard(deps));

  app.onError((err, c) => {
    if (err instanceof ZodError) {
      return c.json({ error: 'invalid_request', issues: err.issues }, 400);
    }
    if (err instanceof ValidationError)
      return c.json({ error: 'invalid_request', message: err.message }, 400);
    if (err instanceof ScopeError)
      return c.json({ error: 'forbidden_path', message: err.message }, err.status);
    console.error('[comment-everything] unhandled error:', err);
    return c.json({ error: 'internal_error' }, 500);
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.get('/health', (c) => c.json({ ok: true, version: deps.version, pid: process.pid }));

  // Scoped static files. The `/s/<token>/` form keeps relative URLs inside served HTML working.
  const filesHandler = async (c: Context) => {
    const m = /^(?:\/s\/[^/]+)?\/files\/([^/]+)\/(.*)$/.exec(c.req.path);
    const root = m?.[1] ? deps.registry.get(m[1]) : undefined;
    if (!m || !root) return c.json({ error: 'not_found' }, 404);
    const file = await resolveScopedPath(root.root, m[2] ?? '');
    const host = c.req.header('host') ?? '';
    return serveFile(file, {
      sandboxHtml: deps.sandboxHtml ?? true,
      range: c.req.header('range'),
      injectScript:
        c.req.query(FRAME_AGENT_FLAG) === '1' && deps.viewerDir
          ? `http://${host}${VIEWER_ASSET_PREFIX}${FRAME_AGENT_FILE}`
          : undefined,
    });
  };
  app.get('/files/:rootId/*', filesHandler);
  app.get('/s/:token/files/:rootId/*', filesHandler);

  // Viewer entry point: shell page carrying the token, scripts come from /_ce/.
  app.get('/view', async (c) => {
    const requested = c.req.query('path');
    if (!requested || !path.isAbsolute(requested)) {
      throw new ValidationError('path must be an absolute file path');
    }
    let real: string;
    try {
      real = await realpath(requested);
    } catch {
      return c.json({ error: 'not_found', message: 'File does not exist' }, 404);
    }
    const root = deps.registry.findContaining(real);
    if (!root) {
      return c.json(
        { error: 'forbidden', message: 'File is not inside a registered project root' },
        403,
      );
    }
    c.header('Cache-Control', 'no-store');
    c.header('X-Frame-Options', 'DENY');
    c.header('Content-Security-Policy', VIEWER_CSP);
    const source = path.relative(root.root, real).split(path.sep).join('/');
    deps.fileWatcher?.watch(root.root, source);
    return c.html(
      renderViewerPage({ token: deps.token, rootId: root.id, root: root.root, source }),
    );
  });

  mountViewerAssets(app, deps.viewerDir);
  mountEventsRoute(app, deps.bus);
  mountRestRoutes(app, deps);
  mountMcpHttpEndpoint(app, deps.service);
  return app;
}

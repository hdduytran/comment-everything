import { createHttpDaemonTransport, createOverlay } from '@comment-everything/overlay';
import { readViewerConfig } from './viewer-config.js';
import { viewerFor } from './viewer-router.js';

/** Entry point of the viewer page served by the daemon at `/view?path=`. */
async function main(): Promise<void> {
  const app = document.getElementById('ce-app');
  if (!app) throw new Error('Viewer root element is missing');
  try {
    const cfg = readViewerConfig();
    const mount = viewerFor(cfg.source);
    if (!mount) {
      app.textContent = `No viewer is available for ${cfg.source} yet.`;
      return;
    }
    const daemon = createHttpDaemonTransport({
      baseUrl: location.origin,
      token: cfg.token,
      source: cfg.source,
      root: cfg.root,
    });
    const viewer = await mount(app, cfg, daemon);
    createOverlay({ source: cfg.source, content: viewer.adapter, daemon });
  } catch (err) {
    app.textContent = `comment-everything could not start: ${(err as Error).message}`;
  }
}

void main();

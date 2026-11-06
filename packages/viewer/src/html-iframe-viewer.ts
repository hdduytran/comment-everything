import { createIframeContentAdapter } from './iframe-content-adapter.js';
import { fileUrl, type ViewerMount } from './viewer-config.js';

/** The daemon splices the frame agent into HTML requested with this query flag. */
const FRAME_FLAG = 'ce-frame=1';

/**
 * Show an HTML file in a sandboxed iframe (no `allow-same-origin`: the page gets an opaque
 * origin and cannot reach the daemon API or the viewer). Reloads when the file changes on disk.
 */
export const mountHtmlViewer: ViewerMount = (container, cfg, daemon) => {
  const iframe = document.createElement('iframe');
  iframe.className = 'ce-html-frame';
  iframe.title = cfg.source;
  iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-modals');
  iframe.referrerPolicy = 'no-referrer';
  const urlFor = (bust?: number) =>
    `${fileUrl(cfg, cfg.source, true)}?${FRAME_FLAG}${bust ? `&v=${bust}` : ''}`;
  iframe.src = urlFor();
  container.replaceChildren(iframe);

  const adapter = createIframeContentAdapter(iframe);
  const off = daemon.subscribe((e) => {
    if (e.type === 'file.changed' && e.path === cfg.source) iframe.src = urlFor(Date.now());
  });
  return {
    adapter,
    dispose() {
      off();
      adapter.dispose();
      iframe.remove();
    },
  };
};

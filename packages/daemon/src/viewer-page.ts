export interface ViewerPageConfig {
  /** Capability token the page uses for every API call. */
  token: string;
  rootId: string;
  /** Absolute project root. */
  root: string;
  /** File path relative to the root (posix separators). */
  source: string;
}

/** URL prefix under which the daemon serves the viewer bundle (scripts, styles, chunks). */
export const VIEWER_ASSET_PREFIX = '/_ce/';

/**
 * Content-Security-Policy for the viewer shell: only the daemon's own bundled scripts may run.
 * Styles allow inline because markdown highlighting and mermaid emit style attributes.
 * Project HTML never runs here; it is framed from `/files/` under its own `sandbox` CSP.
 */
export const VIEWER_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The viewer shell served at `/view?path=`. The bundled viewer reads its configuration
 * (including the token) from `<script type="application/json" id="ce-config">`, which is
 * inert JSON and therefore compatible with the strict `script-src` CSP.
 */
export function renderViewerPage(cfg: ViewerPageConfig): string {
  // `<` is escaped so a hostile file name can never close the script element.
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>comment-everything — ${escapeHtml(cfg.source)}</title>
<link rel="stylesheet" href="${VIEWER_ASSET_PREFIX}viewer.css">
</head>
<body>
<div id="ce-app"><p class="ce-loading">Loading ${escapeHtml(cfg.source)}…</p></div>
<script type="application/json" id="ce-config">${json}</script>
<script type="module" src="${VIEWER_ASSET_PREFIX}viewer-main.js"></script>
</body>
</html>
`;
}

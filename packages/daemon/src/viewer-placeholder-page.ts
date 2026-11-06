export interface ViewerPageConfig {
  /** Capability token the page uses for every API call. */
  token: string;
  rootId: string;
  /** Absolute project root. */
  root: string;
  /** File path relative to the root (posix separators). */
  source: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Placeholder served at `/view?path=` until the real viewer app ships. The viewer reads its
 * configuration (including the token) from `<script type="application/json" id="ce-config">`,
 * which is inert JSON and therefore compatible with a strict `script-src` CSP.
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
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#222}code{background:#f2f2f2;padding:.1rem .3rem;border-radius:3px}</style>
</head>
<body>
<h1>comment-everything</h1>
<p>The viewer UI is not installed yet. The daemon is running and tracking:</p>
<ul>
<li>Project: <code>${escapeHtml(cfg.root)}</code></li>
<li>File: <code>${escapeHtml(cfg.source)}</code></li>
</ul>
<p>Agents can already read comments for this project through the MCP tools.</p>
<script type="application/json" id="ce-config">${json}</script>
</body>
</html>
`;
}

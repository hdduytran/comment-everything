import { randomBytes } from 'node:crypto';
import type { Hono } from 'hono';
import { ValidationError } from './comment-service.js';
import { isExtensionId, type PairedExtensionStore } from './paired-extension-store.js';

const NONCE_TTL_MS = 5 * 60_000;
const MAX_PENDING = 20;

export interface PairingDeps {
  token: string;
  getPort: () => number;
  pairedExtensions: PairedExtensionStore;
}

/** Page CSP: one nonce-gated inline script/style, no framing (clickjacking), no other origins. */
const pairCsp = (nonce: string) =>
  [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

const PAGE_CSS = `body{font:16px system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem;color:#0f172a}
code{background:#f1f5f9;padding:.1rem .3rem;border-radius:4px;word-break:break-all}
button{font:inherit;padding:.6rem 1.2rem;border:0;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer}
button:disabled{opacity:.5}#status{margin-top:1rem}`;

const PAGE_SCRIPT = `const cfg = JSON.parse(document.getElementById('ce-pair').textContent);
const btn = document.getElementById('confirm');
const status = document.getElementById('status');
btn.addEventListener('click', async () => {
  btn.disabled = true;
  try {
    const res = await fetch('/pair/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce: cfg.nonce }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Pairing was refused');
    if (!(window.chrome && chrome.runtime && chrome.runtime.sendMessage)) {
      throw new Error('The extension did not respond. Is it installed and enabled?');
    }
    chrome.runtime.sendMessage(data.ext, { type: 'ce-pair', token: data.token, port: data.port }, (reply) => {
      if (chrome.runtime.lastError || !reply || !reply.ok) {
        status.textContent = 'Paired on the daemon, but the extension did not accept the token. Start pairing again from the extension.';
        return;
      }
      status.textContent = 'Paired. You can close this tab.';
    });
  } catch (err) {
    status.textContent = String(err && err.message ? err.message : err);
    btn.disabled = false;
  }
});`;

function renderPairPage(ext: string, nonce: string): string {
  // `ext` is validated to [a-p]{32}; the nonce is hex. Neither can break out of the markup.
  const cfg = JSON.stringify({ nonce });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Pair Comment Everything extension</title>
<style nonce="${nonce}">${PAGE_CSS}</style></head><body>
<h1>Pair browser extension</h1>
<p>A Chrome extension with id <code>${ext}</code> wants to send comments to this daemon.</p>
<p>Only continue if you started this from the Comment Everything extension in your own browser.</p>
<button id="confirm" type="button">Pair this extension</button>
<p id="status" role="status"></p>
<script type="application/json" id="ce-pair">${cfg}</script>
<script nonce="${nonce}">${PAGE_SCRIPT}</script>
</body></html>`;
}

/**
 * Extension pairing. `/pair?ext=<id>` renders a confirmation page; the click POSTs a one-time
 * nonce to `/pair/confirm`, which records the extension id (origin pinning) and returns the
 * token to that same-origin page, which hands it to the extension through
 * `externally_connectable` messaging. A hostile site cannot confirm for the user: the nonce lives
 * only in the framing-protected page and the POST must carry the daemon's own Origin.
 */
export function mountPairingRoutes(app: Hono, deps: PairingDeps): void {
  const pending = new Map<string, { ext: string; expires: number }>();
  const prune = () => {
    const now = Date.now();
    for (const [n, p] of pending) if (p.expires < now) pending.delete(n);
  };

  app.get('/pair', (c) => {
    const ext = c.req.query('ext') ?? '';
    if (!isExtensionId(ext)) throw new ValidationError('ext must be a Chrome extension id');
    prune();
    if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value as string);
    const nonce = randomBytes(24).toString('hex');
    pending.set(nonce, { ext, expires: Date.now() + NONCE_TTL_MS });
    c.header('Cache-Control', 'no-store');
    c.header('X-Frame-Options', 'DENY');
    c.header('Content-Security-Policy', pairCsp(nonce));
    return c.html(renderPairPage(ext, nonce));
  });

  app.post('/pair/confirm', async (c) => {
    // The host guard already pinned Host to the loopback daemon, so this is a same-origin check.
    if (c.req.header('origin') !== `http://${c.req.header('host')}`) {
      return c.json(
        { error: 'forbidden', message: 'Pairing must be confirmed on the daemon page' },
        403,
      );
    }
    const body = (await c.req.json().catch(() => null)) as { nonce?: unknown } | null;
    const nonce = typeof body?.nonce === 'string' ? body.nonce : '';
    prune();
    const entry = pending.get(nonce);
    if (!entry) {
      return c.json({ error: 'forbidden', message: 'Pairing request expired; start again' }, 403);
    }
    pending.delete(nonce); // one-time
    await deps.pairedExtensions.add(entry.ext);
    c.header('Cache-Control', 'no-store');
    return c.json({ ext: entry.ext, token: deps.token, port: deps.getPort() });
  });
}

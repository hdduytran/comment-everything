import { timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';

export const TOKEN_HEADER = 'x-ce-token';

export interface GuardConfig {
  token: string;
  /** Port the server actually listens on (known only after `listen`). */
  getPort: () => number;
  /** Whether this Chrome extension id was paired by the user; only those origins are allowed. */
  isPairedExtension?: (id: string) => boolean;
}

/** `/files/...` or the token-in-path form `/s/<token>/files/...`. */
export const FILES_PATH = /^\/(?:s\/[^/]+\/)?files\//;

/** Paths reachable without a token (still subject to Host and Origin checks). */
const PUBLIC_PATHS = new Set(['/health', '/view', '/pair', '/pair/confirm']);
/** Static viewer bundle: code only, no secrets, and the sandboxed frame agent loads it tokenless. */
const PUBLIC_PREFIXES = ['/_ce/'];

function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function daemonHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

function isAllowedOrigin(origin: string, cfg: GuardConfig, path: string): boolean {
  if (daemonHosts(cfg.getPort()).some((h) => origin === `http://${h}`)) return true;
  const ext = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
  if (ext?.[1] && cfg.isPairedExtension?.(ext[1])) return true;
  // Sandboxed project HTML has an opaque ("null") origin; it may only read scoped files,
  // and still needs the capability token carried in its URL.
  return origin === 'null' && FILES_PATH.test(path);
}

/** Reject requests whose Host header is not the loopback daemon (DNS-rebinding defence). */
export function hostGuard(cfg: GuardConfig): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header('host');
    if (!host || !daemonHosts(cfg.getPort()).includes(host.toLowerCase())) {
      return c.json({ error: 'forbidden', message: 'Unexpected Host header' }, 403);
    }
    await next();
  };
}

/**
 * Origin policy: requests with no Origin (CLI, curl, same-origin GET navigation) pass;
 * browser requests must come from the daemon itself or a paired chrome-extension:// page.
 * Handles CORS preflight and adds CORS headers for allowed cross-origin callers.
 */
export function originGuard(cfg: GuardConfig): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('origin');
    if (origin === undefined) return next();
    if (!isAllowedOrigin(origin, cfg, c.req.path)) {
      return c.json({ error: 'forbidden', message: 'Origin not allowed' }, 403);
    }
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
    if (c.req.method === 'OPTIONS') {
      c.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      c.header(
        'Access-Control-Allow-Headers',
        `authorization,content-type,${TOKEN_HEADER},mcp-session-id,mcp-protocol-version,last-event-id`,
      );
      c.header('Access-Control-Max-Age', '600');
      return c.body(null, 204);
    }
    await next();
  };
}

/**
 * Pull the presented token from headers, `?token=` on GET (EventSource cannot set headers),
 * or the `/s/<token>/files/...` path prefix (lets relative URLs inside served HTML keep working).
 */
export function presentedToken(c: Context): string | undefined {
  const inPath = /^\/s\/([^/]+)\/files\//.exec(c.req.path);
  if (inPath?.[1] && c.req.method === 'GET') {
    try {
      return decodeURIComponent(inPath[1]);
    } catch {
      return undefined;
    }
  }
  const auth = c.req.header('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const h = c.req.header(TOKEN_HEADER);
  if (h) return h;
  return c.req.method === 'GET' ? c.req.query('token') : undefined;
}

/** Require the per-install token on every non-public route (401 when missing or wrong). */
export function tokenGuard(cfg: GuardConfig): MiddlewareHandler {
  return async (c, next) => {
    if (
      PUBLIC_PATHS.has(c.req.path) ||
      PUBLIC_PREFIXES.some((p) => c.req.path.startsWith(p)) ||
      c.req.method === 'OPTIONS'
    ) {
      return next();
    }
    const token = presentedToken(c);
    if (!token || !constantTimeEqual(token, cfg.token)) {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json({ error: 'unauthorized', message: 'Missing or invalid token' }, 401);
    }
    await next();
  };
}

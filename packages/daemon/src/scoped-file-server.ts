import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

/** Error carrying the HTTP status the file endpoint should answer with. */
export class ScopeError extends Error {
  constructor(
    readonly status: 400 | 403 | 404,
    message: string,
  ) {
    super(message);
    this.name = 'ScopeError';
  }
}

/** Directory names that are never served even inside a registered root. */
const BLOCKED_SEGMENTS = new Set(['.git']);

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolve a URL-relative path against `root` and return the canonical file path.
 * Rejects `..` segments, NUL bytes, backslashes and blocked folders (403/400), and
 * rejects symlinks whose real target is outside the root (403). Missing -> 404.
 */
export async function resolveScopedPath(root: string, rawRelPath: string): Promise<string> {
  let rel: string;
  try {
    rel = decodeURIComponent(rawRelPath);
  } catch {
    throw new ScopeError(400, 'Malformed path encoding');
  }
  if (rel.includes('\0')) throw new ScopeError(400, 'Invalid path');
  if (rel.includes('\\')) throw new ScopeError(403, 'Path escapes project root');
  const segments = rel.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.includes('..')) throw new ScopeError(403, 'Path escapes project root');
  if (segments.some((s) => BLOCKED_SEGMENTS.has(s)))
    throw new ScopeError(403, 'Path is not served');

  const canonicalRoot = await realpath(root);
  const target = path.join(canonicalRoot, ...segments);
  let real: string;
  try {
    real = await realpath(target);
  } catch {
    throw new ScopeError(404, 'Not found');
  }
  if (!isInside(canonicalRoot, real)) throw new ScopeError(403, 'Path escapes project root');
  const relReal = path.relative(canonicalRoot, real).split(path.sep);
  if (relReal.some((s) => BLOCKED_SEGMENTS.has(s))) throw new ScopeError(403, 'Path is not served');
  return real;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
};

export function mimeTypeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export interface ServeOptions {
  /** Add a CSP `sandbox` so served HTML/SVG gets an opaque origin and cannot reach the daemon API. */
  sandboxHtml: boolean;
  /** Value of the incoming `Range` header, if any. */
  range?: string | null;
}

/** Build a Response (with Range support for media seeking) for a resolved file. */
export async function serveFile(file: string, opts: ServeOptions): Promise<Response> {
  const info = await stat(file);
  if (!info.isFile()) throw new ScopeError(404, 'Not found');
  const type = mimeTypeFor(file);
  const headers = new Headers({
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  if (opts.sandboxHtml && (type.startsWith('text/html') || type.startsWith('image/svg'))) {
    headers.set(
      'Content-Security-Policy',
      'sandbox allow-scripts allow-forms allow-popups allow-modals',
    );
  }

  let start = 0;
  let end = info.size - 1;
  let status = 200;
  const m = opts.range ? /^bytes=(\d*)-(\d*)$/.exec(opts.range.trim()) : null;
  if (m && (m[1] !== '' || m[2] !== '')) {
    if (m[1] === '') {
      start = Math.max(0, info.size - Number(m[2])); // suffix range: last N bytes
    } else {
      start = Number(m[1]);
      if (m[2] !== '') end = Math.min(Number(m[2]), end);
    }
    if (start > end || start >= info.size) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${info.size}` },
      });
    }
    status = 206;
    headers.set('Content-Range', `bytes ${start}-${end}/${info.size}`);
  }
  headers.set('Content-Length', String(info.size === 0 ? 0 : end - start + 1));
  if (info.size === 0) return new Response(null, { status: 200, headers });
  const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
  return new Response(stream, { status, headers });
}

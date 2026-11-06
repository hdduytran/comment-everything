import type { UrlResolver } from './markdown-render.js';
import { fileUrl, type ViewerConfig } from './viewer-config.js';

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Resolve `ref` against the Markdown file's folder; null when it would leave the project. */
export function resolveProjectPath(source: string, ref: string): string | null {
  const clean = decodeURI(ref.split(/[?#]/)[0] ?? '');
  const parts = clean.startsWith('/') ? [] : source.split('/').slice(0, -1);
  for (const seg of clean.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

/**
 * Project-relative images load from the daemon's scoped file server; relative links open in the
 * viewer; only http(s)/mailto links and https/data images are allowed through from the document.
 */
export function createUrlResolver(cfg: ViewerConfig): UrlResolver {
  return {
    image(src) {
      if (/^https:|^data:image\//i.test(src)) return src;
      if (SCHEME.test(src) || src.startsWith('//')) return '';
      const rel = resolveProjectPath(cfg.source, src);
      return rel ? fileUrl(cfg, rel, true) : '';
    },
    link(href) {
      if (href.startsWith('#')) return { href, external: false };
      if (/^(https?:|mailto:)/i.test(href)) return { href, external: true };
      if (SCHEME.test(href) || href.startsWith('//')) return { href: '#', external: false };
      const rel = resolveProjectPath(cfg.source, href);
      if (!rel) return { href: '#', external: false };
      const hash = /#.*$/.exec(href)?.[0] ?? '';
      return {
        href: `/view?path=${encodeURIComponent(`${cfg.root}/${rel}`)}${hash}`,
        external: false,
      };
    },
  };
}

import type { ReanchorSurface } from './reanchor-engine.js';

export type SourceKind = 'markdown' | 'html' | 'text';

/** Searchable text of a source file plus a map between offsets and 1-based source lines. */
export interface SourceProjection extends ReanchorSurface {
  /** 1-based source line containing `offset` (clamped to the file). Lines only for md/text. */
  lineAt(offset: number): number;
}

const MEDIA_EXT = /\.(png|jpe?g|gif|webp|avif|ico|pdf|mp4|webm|mov|mkv|mp3|wav|ogg|m4a|flac)$/i;

/** Which projection fits a file, or null for files that carry no re-anchorable text. */
export function sourceKindFor(source: string): SourceKind | null {
  if (/^https?:\/\//i.test(source) || MEDIA_EXT.test(source)) return null;
  if (/\.(md|markdown|mdx)$/i.test(source)) return 'markdown';
  if (/\.html?$/i.test(source)) return 'html';
  return 'text';
}

/** Collapse whitespace so reflowed or re-indented text still matches. */
export const collapseWhitespace = (s: string): string => s.replace(/\s+/g, ' ');

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Strip inline Markdown syntax down to the text a reader sees. */
function stripMarkdownLine(line: string, state: { fence: string | null }): string {
  const fence = /^\s*(```+|~~~+)/.exec(line);
  if (fence) {
    state.fence = state.fence ? null : fence[1]!;
    return '';
  }
  if (state.fence) return line;
  if (/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-')) return ''; // table rule
  return line
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?)+/, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/(\*\*|__|~~|[*`])/g, '')
    .replace(/(^|\s)_+|_+(?=\s|$)/g, '$1')
    .replace(/\|/g, ' ');
}

function projectLines(src: string, strip: (line: string) => string): SourceProjection {
  const lines = src.split(/\r?\n/);
  const starts: number[] = [];
  const ends: number[] = [];
  let text = '';
  for (const raw of lines) {
    const line = collapseWhitespace(strip(raw)).trim();
    if (line && text) text += ' ';
    starts.push(text.length);
    text += line;
    ends.push(text.length);
  }
  return {
    text,
    spanOfLines(r) {
      if (r.startLine > lines.length) return null;
      const last = Math.min(r.endLine, lines.length) - 1;
      const start = starts[r.startLine - 1]!;
      const end = ends[last]!;
      return end > start ? { start, end } : null;
    },
    lineAt(offset) {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid]! <= offset) lo = mid;
        else hi = mid - 1;
      }
      // Blank lines share their start with the next content line; prefer the content line.
      while (lo > 0 && starts[lo] === starts[lo - 1] && ends[lo] === starts[lo]) lo--;
      return lo + 1;
    },
  };
}

function projectHtml(src: string): SourceProjection {
  const text = collapseWhitespace(
    decodeEntities(
      src
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<\/?[a-zA-Z][^>]*>/g, ''),
    ),
  );
  return { text, lineAt: () => 1 };
}

/** Build the searchable projection the re-anchoring engine runs on. */
export function projectSource(kind: SourceKind, src: string): SourceProjection {
  if (kind === 'html') return projectHtml(src);
  if (kind === 'text') return projectLines(src, (l) => l);
  const state = { fence: null as string | null };
  return projectLines(src, (l) => stripMarkdownLine(l, state));
}

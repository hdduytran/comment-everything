/**
 * Approximate TextQuote matching with prefix/suffix scoring. Pure string code (no DOM, no Node)
 * so the same matcher serves the daemon, the viewer and the extension.
 *
 * Strategy: exact occurrences are scored by context first (cheap, the common case). Otherwise
 * short seeds taken from the quote locate candidate windows, and a semi-global edit-distance
 * scan (Sellers) finds the best-matching substring inside each window.
 */

export interface QuoteQuery {
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface QuoteMatch {
  start: number;
  end: number;
  /** 0..1 combined score: quote similarity weighted with context and proximity. */
  score: number;
  /** 0..1 similarity of the matched text to `exact` alone. */
  similarity: number;
}

export interface FuzzyOptions {
  /** Expected start offset (previous position); nearer matches win ties. */
  hint?: number;
  /** Minimum quote similarity to accept (default 0.7). */
  minSimilarity?: number;
}

const SEED_LEN = 8;
const MAX_CANDIDATES = 40;
const CONTEXT_LEN = 48;
const FULL_SCAN_CELLS = 2_000_000;

/** Levenshtein-based similarity of two short strings, 0..1. */
export function editSimilarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
        prev[j]! + 1,
        cur[j - 1]! + 1,
      );
    }
    prev = cur;
  }
  return 1 - prev[b.length]! / max;
}

/** Best substring of `window` for `pattern` (Sellers): returns [start, end) and edit distance. */
function bestSubstring(
  pattern: string,
  window: string,
): { start: number; end: number; dist: number } {
  const m = pattern.length;
  // Per column: distance and the window offset where the best alignment started.
  let dist = new Array<number>(window.length + 1).fill(0);
  let from = Array.from({ length: window.length + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const nd = new Array<number>(window.length + 1);
    const nf = new Array<number>(window.length + 1);
    nd[0] = i;
    nf[0] = 0;
    for (let j = 1; j <= window.length; j++) {
      const sub = dist[j - 1]! + (pattern[i - 1] === window[j - 1] ? 0 : 1);
      const del = dist[j]! + 1;
      const ins = nd[j - 1]! + 1;
      if (sub <= del && sub <= ins) {
        nd[j] = sub;
        nf[j] = from[j - 1]!;
      } else if (del <= ins) {
        nd[j] = del;
        nf[j] = from[j]!;
      } else {
        nd[j] = ins;
        nf[j] = nf[j - 1]!;
      }
    }
    dist = nd;
    from = nf;
  }
  let end = 0;
  for (let j = 1; j <= window.length; j++) if (dist[j]! < dist[end]!) end = j;
  return { start: from[end]!, end, dist: dist[end]! };
}

/** Mean similarity of the text around `[start, end)` to the quote's prefix/suffix; null if none stored. */
export function contextSimilarity(
  text: string,
  start: number,
  end: number,
  q: QuoteQuery,
): number | null {
  const parts: number[] = [];
  if (q.prefix) {
    const p = q.prefix.slice(-CONTEXT_LEN);
    parts.push(editSimilarity(text.slice(Math.max(0, start - p.length), start), p));
  }
  if (q.suffix) {
    const s = q.suffix.slice(0, CONTEXT_LEN);
    parts.push(editSimilarity(text.slice(end, end + s.length), s));
  }
  return parts.length === 0 ? null : parts.reduce((a, b) => a + b, 0) / parts.length;
}

function combine(
  text: string,
  start: number,
  end: number,
  similarity: number,
  q: QuoteQuery,
  hint: number | undefined,
): QuoteMatch {
  const context = contextSimilarity(text, start, end, q) ?? 0.5;
  const near = hint === undefined ? 0.5 : 1 / (1 + Math.abs(start - hint) / 500);
  return { start, end, similarity, score: similarity * 0.6 + context * 0.3 + near * 0.1 };
}

/** Candidate window start offsets: positions where a seed of the quote occurs verbatim. */
function seedPositions(text: string, exact: string): number[] {
  const seen = new Set<number>();
  const step = Math.max(1, Math.floor(SEED_LEN / 2));
  const seedLen = Math.min(SEED_LEN, exact.length);
  for (let i = 0; i + seedLen <= exact.length && seen.size < MAX_CANDIDATES; i += step) {
    const seed = exact.slice(i, i + seedLen);
    for (let at = text.indexOf(seed); at !== -1; at = text.indexOf(seed, at + 1)) {
      seen.add(Math.max(0, at - i));
      if (seen.size >= MAX_CANDIDATES) break;
    }
  }
  return [...seen];
}

/**
 * Find the best location of `q.exact` in `text`, tolerating edits inside the quote and in the
 * context. Returns null when nothing reaches `minSimilarity`.
 */
export function fuzzyFindQuote(
  text: string,
  q: QuoteQuery,
  opts: FuzzyOptions = {},
): QuoteMatch | null {
  const exact = q.exact;
  if (!exact || !text) return null;
  const min = opts.minSimilarity ?? 0.7;
  let best = null as QuoteMatch | null;
  const consider = (m: QuoteMatch) => {
    if (m.similarity >= min && (!best || m.score > best.score)) best = m;
  };

  let exactHits = 0;
  for (let i = text.indexOf(exact); i !== -1; i = text.indexOf(exact, i + 1)) {
    consider(combine(text, i, i + exact.length, 1, q, opts.hint));
    if (++exactHits >= 500) break;
  }
  if (best) return best;

  if (exact.length < 4) return null;
  const slack = Math.ceil(exact.length * (1 - min)) + 2;
  const windows: [number, number][] = seedPositions(text, exact).map((s) => [
    Math.max(0, s - slack),
    Math.min(text.length, s + exact.length + slack),
  ]);
  // No seed survived the edits: scan everything when that is affordable.
  if (windows.length === 0 && text.length * exact.length <= FULL_SCAN_CELLS) {
    windows.push([0, text.length]);
  }
  for (const [lo, hi] of windows) {
    const found = bestSubstring(exact, text.slice(lo, hi));
    const len = found.end - found.start;
    if (len === 0) continue;
    const similarity = 1 - found.dist / Math.max(exact.length, len);
    consider(combine(text, lo + found.start, lo + found.end, similarity, q, opts.hint));
  }
  return best;
}

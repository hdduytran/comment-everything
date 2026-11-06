/**
 * Text offsets used by TextPosition/TextQuote selectors: the plain concatenation of all text
 * nodes under `root` (identical to `root.textContent`), with no whitespace normalization.
 */

export function fullText(root: Node): string {
  return root.textContent ?? '';
}

/** Offset of a DOM boundary point inside `root`'s text. */
export function offsetOf(root: Node, node: Node, offset: number): number {
  const doc = root.ownerDocument ?? (root as Document);
  const r = doc.createRange();
  r.setStart(root, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

/** Build a DOM range covering `[start, end)` of `root`'s text, or null when out of bounds. */
export function rangeFromOffsets(root: Node, start: number, end: number): Range | null {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const range = doc.createRange();
  let pos = 0;
  let startSet = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = (n.nodeValue ?? '').length;
    if (!startSet && start < pos + len) {
      range.setStart(n, start - pos);
      startSet = true;
    }
    if (startSet && end <= pos + len) {
      range.setEnd(n, end - pos);
      return range;
    }
    pos += len;
  }
  return null;
}

export interface QuoteQuery {
  exact: string;
  prefix?: string;
  suffix?: string;
}

/**
 * Locate a quote in `root`'s text. When the quote occurs several times, the occurrence whose
 * surrounding text best matches `prefix`/`suffix` wins (ties go to the first).
 */
export function findQuote(root: Node, q: QuoteQuery): { start: number; end: number } | null {
  if (!q.exact) return null;
  const text = fullText(root);
  let best: { start: number; score: number } | null = null;
  for (let i = text.indexOf(q.exact); i !== -1; i = text.indexOf(q.exact, i + 1)) {
    let score = 0;
    if (q.prefix && text.slice(Math.max(0, i - q.prefix.length), i).endsWith(q.prefix)) score += 1;
    if (q.suffix && text.startsWith(q.suffix, i + q.exact.length)) score += 1;
    if (!best || score > best.score) best = { start: i, score };
    if (score === 2) break;
  }
  return best ? { start: best.start, end: best.start + q.exact.length } : null;
}

import { contextSimilarity, fuzzyFindQuote } from './fuzzy-text-quote-matcher.js';
import type {
  CssSelector,
  LineRangeSelector,
  Selector,
  TextQuoteSelector,
  XPathSelector,
} from './selector-schemas.js';

/** Half-open character range `[start, end)` in a surface's searchable text. */
export interface TextSpan {
  start: number;
  end: number;
}

/**
 * What the engine searches: the plain searchable text of a source plus optional hooks the host
 * provides. A DOM host resolves CSS/XPath to the text span of the element; a Markdown host maps
 * line numbers to spans. All hooks are optional so one engine serves every kind of source.
 */
export interface ReanchorSurface {
  text: string;
  resolveStructural?(sel: CssSelector | XPathSelector): TextSpan | null;
  /** Span covering whole source lines (1-based, inclusive), or null when out of range. */
  spanOfLines?(range: LineRangeSelector): TextSpan | null;
}

export interface ReanchorOptions {
  /** Previously resolved span; used as a proximity hint. */
  last?: TextSpan;
  /** Quote to search with when the comment stores none (e.g. recovered from the old text). */
  fallbackQuote?: string;
}

export type ReanchorVia = 'structural' | 'quote' | 'position' | 'lines';

export interface ReanchorOutcome {
  /** Null means the content could not be found: the comment is orphaned. */
  span: TextSpan | null;
  via?: ReanchorVia;
}

const VERIFY_SIMILARITY = 0.8;
const CONTEXT_FLOOR = 0.5;

const isStructural = (s: Selector): s is CssSelector | XPathSelector =>
  s.type === 'CssSelector' || s.type === 'XPathSelector';

/**
 * Re-locate a comment's target after its source changed. Order, most to least trusted:
 * 1. CSS/XPath, accepted only when the element still contains the stored quote;
 * 2. fuzzy TextQuote search (prefix/suffix scored);
 * 3. TextPosition / LineRange, trusted only when the comment has no quote to check against.
 * Anything else is `span: null` (orphaned).
 */
export function reanchor(
  surface: ReanchorSurface,
  selectors: readonly Selector[],
  opts: ReanchorOptions = {},
): ReanchorOutcome {
  const quote = selectors.find((s): s is TextQuoteSelector => s.type === 'TextQuoteSelector');
  const position = selectors.find((s) => s.type === 'TextPositionSelector');
  const lines = selectors.find((s) => s.type === 'LineRangeSelector');
  const hint = opts.last?.start ?? position?.start;
  const query = quote ?? (opts.fallbackQuote ? { exact: opts.fallbackQuote } : null);

  // Selectors are stored most precise first: a text selection lists its quote before the CSS
  // selector of its container, so the structural pass must not widen it to the whole element.
  const quoteAt = selectors.findIndex((s) => s.type === 'TextQuoteSelector');
  const structuralAt = selectors.findIndex(isStructural);
  const structural = quoteAt !== -1 && quoteAt < structuralAt ? [] : selectors.filter(isStructural);

  for (const sel of structural) {
    let span: TextSpan | null = null;
    try {
      span = surface.resolveStructural?.(sel) ?? null;
    } catch {
      continue; // selector syntax from a foreign or older comment
    }
    if (!span) continue;
    if (!query) return { span, via: 'structural' };
    const inside = surface.text.slice(span.start, span.end);
    const hit = fuzzyFindQuote(inside, query, { minSimilarity: VERIFY_SIMILARITY });
    if (!hit) continue;
    const found = { start: span.start + hit.start, end: span.start + hit.end };
    // A repeated phrase can match the wrong copy; the surrounding text must still fit.
    const context = contextSimilarity(surface.text, found.start, found.end, query);
    if (context === null || context >= CONTEXT_FLOOR) return { span, via: 'structural' };
  }

  if (query) {
    const hit = fuzzyFindQuote(surface.text, query, { hint });
    return hit ? { span: { start: hit.start, end: hit.end }, via: 'quote' } : { span: null };
  }

  if (position && position.end <= surface.text.length) {
    return { span: { start: position.start, end: position.end }, via: 'position' };
  }
  const byLines = lines ? surface.spanOfLines?.(lines) : null;
  return byLines ? { span: byLines, via: 'lines' } : { span: null };
}

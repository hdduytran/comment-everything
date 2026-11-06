import type { Comment, CommentPatch } from './comment-schema.js';
import { reanchor } from './reanchor-engine.js';
import type { Selector } from './selector-schemas.js';
import {
  collapseWhitespace,
  projectSource,
  sourceKindFor,
  type SourceKind,
} from './source-text-projection.js';

/** Selector types the text-source pass can act on. */
const RELEVANT = new Set([
  'TextQuoteSelector',
  'TextPositionSelector',
  'LineRangeSelector',
  'CssSelector',
  'XPathSelector',
]);

/** Quotes come from rendered text; compare them in the same whitespace-collapsed form. */
function normalizeSelectors(selectors: readonly Selector[], kind: SourceKind): Selector[] {
  return selectors
    // Positions of rendered Markdown/HTML text do not map onto the source text.
    .filter((s) => kind === 'text' || s.type !== 'TextPositionSelector')
    .map((s) =>
      s.type === 'TextQuoteSelector'
        ? {
            ...s,
            exact: collapseWhitespace(s.exact).trim(),
            prefix: s.prefix && collapseWhitespace(s.prefix),
            suffix: s.suffix && collapseWhitespace(s.suffix),
          }
        : s,
    );
}

/**
 * Re-anchor one comment against the new text of its source file (Markdown, HTML or plain text).
 * `previousText` is the file before the change; it lets comments that store no quote (only a
 * line range) recover what they pointed at. Returns the patch to apply, or null when nothing
 * changed or the comment cannot be judged from source text alone (e.g. CSS-only on HTML).
 *
 * Only `anchorState`, `lastResolved` and the LineRange selector are rewritten: quote and
 * position selectors describe the rendered page and are left for the viewer to re-resolve.
 */
export function reanchorComment(
  comment: Comment,
  newText: string,
  previousText?: string,
): CommentPatch | null {
  const kind = sourceKindFor(comment.source);
  if (!kind || !comment.selectors.some((s) => RELEVANT.has(s.type))) return null;
  const next = projectSource(kind, newText);
  const selectors = normalizeSelectors(comment.selectors, kind);
  const lineSel = comment.selectors.find((s) => s.type === 'LineRangeSelector');
  const hasQuote = selectors.some((s) => s.type === 'TextQuoteSelector');

  let fallbackQuote: string | undefined;
  if (!hasQuote && previousText !== undefined) {
    const prev = projectSource(kind, previousText);
    const old = comment.lastResolved ?? (lineSel && prev.spanOfLines?.(lineSel)) ?? undefined;
    if (old) fallbackQuote = prev.text.slice(old.start, old.end).trim() || undefined;
  }
  // HTML cannot be judged without a quote: CSS/XPath need a DOM, which only the viewer has.
  if (kind === 'html' && !hasQuote && !fallbackQuote) return null;

  const { span } = reanchor(next, selectors, { last: comment.lastResolved, fallbackQuote });
  if (!span) {
    return comment.anchorState === 'orphaned' ? null : { anchorState: 'orphaned' };
  }

  const patch: CommentPatch = {};
  const lastResolved: NonNullable<Comment['lastResolved']> = { start: span.start, end: span.end };
  let state: 'ok' | 'moved' = 'ok';
  if (kind !== 'html') {
    const startLine = next.lineAt(span.start);
    const endLine = Math.max(startLine, next.lineAt(Math.max(span.start, span.end - 1)));
    Object.assign(lastResolved, { startLine, endLine });
    if (lineSel?.type === 'LineRangeSelector') {
      if (lineSel.startLine !== startLine || lineSel.endLine !== endLine) {
        state = 'moved';
        patch.selectors = comment.selectors.map((s) =>
          s.type === 'LineRangeSelector' ? { ...s, startLine, endLine } : s,
        );
      }
    } else if (comment.lastResolved && comment.lastResolved.start !== span.start) {
      state = 'moved';
    }
  } else if (comment.lastResolved && comment.lastResolved.start !== span.start) {
    state = 'moved';
  }

  const prev = comment.lastResolved;
  const sameResolved =
    prev?.start === lastResolved.start &&
    prev.end === lastResolved.end &&
    prev.startLine === lastResolved.startLine &&
    prev.endLine === lastResolved.endLine;
  // `moved` is sticky: it records that the comment no longer sits where it was made.
  if (state === 'ok' && comment.anchorState === 'moved') state = 'moved';
  if (comment.anchorState !== state) patch.anchorState = state;
  if (!sameResolved) patch.lastResolved = lastResolved;
  return Object.keys(patch).length > 0 ? patch : null;
}

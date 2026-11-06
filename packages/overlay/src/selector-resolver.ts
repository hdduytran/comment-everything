import { reanchor, type ReanchorSurface, type Selector } from '@comment-everything/core/browser';
import { fullText, offsetOf, rangeFromOffsets } from './text-index.js';

/** Something with a bounding box that a pin can be attached to. */
export type Anchorable = Element | Range;

/**
 * Find what a comment's selectors point at in the current document using the shared
 * re-anchoring engine: CSS/XPath (accepted only while the element still holds the stored
 * quote), then fuzzy TextQuote search, then stored positions for quote-less comments.
 * Line-range and screenshot selectors are ignored here (hosts resolve those themselves).
 */
export function resolveSelectors(
  doc: Document,
  root: Node,
  selectors: readonly Selector[],
): Anchorable | null {
  let element = null as Element | null;
  const surface: ReanchorSurface = {
    text: fullText(root),
    resolveStructural(sel) {
      let found: Element | null = null;
      if (sel.type === 'CssSelector') {
        found = doc.querySelector(sel.value);
      } else {
        const hit = doc.evaluate(sel.value, doc, null, 9 /* FIRST_ORDERED_NODE_TYPE */, null);
        found = hit.singleNodeValue instanceof Element ? hit.singleNodeValue : null;
      }
      if (!found) return null;
      element = found;
      // Elements outside the text root (e.g. <html>) have no span; an empty one cannot verify a quote.
      if (!root.contains(found)) return { start: 0, end: 0 };
      const start = offsetOf(root, found, 0);
      return { start, end: start + (found.textContent ?? '').length };
    },
  };
  const { span, via } = reanchor(surface, selectors);
  if (!span) return null;
  if (via === 'structural' && element) return element;
  return rangeFromOffsets(root, span.start, span.end);
}

/** Client rectangles of a target (one per line box for multi-line ranges). */
export function rectsOf(target: Anchorable): DOMRect[] {
  const rects = [...target.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
  return rects.length > 0 ? rects : [target.getBoundingClientRect()];
}

import type { Selector } from '@comment-everything/core/browser';
import { findQuote, rangeFromOffsets } from './text-index.js';

/** Something with a bounding box that a pin can be attached to. */
export type Anchorable = Element | Range;

/**
 * Find what a comment's selectors point at in the current document. Selectors are tried in the
 * order the creator stored them (most precise first); the first that resolves wins.
 * Line-range and screenshot selectors are ignored here (hosts resolve those themselves).
 */
export function resolveSelectors(
  doc: Document,
  root: Node,
  selectors: readonly Selector[],
): Anchorable | null {
  for (const sel of selectors) {
    const found = resolveOne(doc, root, sel, selectors);
    if (found) return found;
  }
  return null;
}

function resolveOne(
  doc: Document,
  root: Node,
  sel: Selector,
  all: readonly Selector[],
): Anchorable | null {
  try {
    switch (sel.type) {
      case 'CssSelector':
        return doc.querySelector(sel.value);
      case 'XPathSelector': {
        const hit = doc.evaluate(sel.value, doc, null, 9 /* FIRST_ORDERED_NODE_TYPE */, null);
        return hit.singleNodeValue instanceof Element ? hit.singleNodeValue : null;
      }
      case 'TextQuoteSelector': {
        const at = findQuote(root, sel);
        return at ? rangeFromOffsets(root, at.start, at.end) : null;
      }
      case 'TextPositionSelector': {
        // Positions alone are brittle; only trust them when no quote is stored to verify against.
        if (all.some((s) => s.type === 'TextQuoteSelector')) return null;
        return rangeFromOffsets(root, sel.start, sel.end);
      }
      default:
        return null;
    }
  } catch {
    return null; // invalid selector syntax from an older or foreign comment
  }
}

/** Client rectangles of a target (one per line box for multi-line ranges). */
export function rectsOf(target: Anchorable): DOMRect[] {
  const rects = [...target.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
  return rects.length > 0 ? rects : [target.getBoundingClientRect()];
}

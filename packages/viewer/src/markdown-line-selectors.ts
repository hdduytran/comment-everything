import type { LineRangeSelector } from '@comment-everything/core/browser';

/** Attributes added to every rendered block: 1-based inclusive source line numbers. */
export const LINE_START = 'data-line-start';
export const LINE_END = 'data-line-end';

export interface LineSpan {
  start: number;
  end: number;
}

const toElement = (n: Node | null | undefined): Element | null =>
  n instanceof Element ? n : (n?.parentElement ?? null);

/** Nearest rendered block (inside `root`) that carries source line attributes. */
export function closestBlock(node: Node | null | undefined, root: Element): HTMLElement | null {
  for (let n = toElement(node); n && n !== root; n = n.parentElement) {
    if (n.hasAttribute(LINE_START)) return n as HTMLElement;
  }
  return null;
}

export function spanOf(block: Element): LineSpan {
  const start = Number(block.getAttribute(LINE_START));
  const end = Number(block.getAttribute(LINE_END));
  return { start, end: Math.max(start, end) };
}

export function lineRangeForElement(el: Element, root: Element): LineRangeSelector | null {
  const block = closestBlock(el, root);
  if (!block) return null;
  const { start, end } = spanOf(block);
  return { type: 'LineRangeSelector', startLine: start, endLine: end };
}

/** First/last non-blank line of the selected text, trimmed and clipped for matching. */
function edgeChunk(selected: string, which: 'first' | 'last'): string {
  const lines = selected
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const line = (which === 'first' ? lines[0] : lines[lines.length - 1]) ?? '';
  return which === 'first' ? line.slice(0, 80) : line.slice(-80);
}

/**
 * Narrow a block's line span to the lines the selected text actually touches, by looking for the
 * selection's first and last line inside the block's source. Falls back to the whole block when
 * the rendered text differs from the source (inline formatting, links, escapes).
 */
export function refineLines(
  sourceLines: readonly string[],
  block: LineSpan,
  selected: string,
): LineSpan {
  const first = edgeChunk(selected, 'first');
  const last = edgeChunk(selected, 'last');
  let { start, end } = block;
  if (first) {
    for (let line = block.start; line <= block.end; line++) {
      if (sourceLines[line - 1]?.includes(first)) {
        start = line;
        break;
      }
    }
  }
  if (last) {
    for (let line = block.end; line >= start; line--) {
      if (sourceLines[line - 1]?.includes(last)) {
        end = line;
        break;
      }
    }
  }
  return { start, end: Math.max(start, end) };
}

/** Boundary node of a range endpoint, descending into the child the offset points at. */
function boundaryNode(container: Node, offset: number, side: 'start' | 'end'): Node {
  if (!(container instanceof Element)) return container;
  const child = side === 'start' ? container.childNodes[offset] : container.childNodes[offset - 1];
  return child ?? container;
}

/** Line range covered by a text selection (precise when the source line can be matched). */
export function lineRangeForRange(
  range: Range,
  root: Element,
  sourceLines: readonly string[],
): LineRangeSelector | null {
  const startBlock = closestBlock(
    boundaryNode(range.startContainer, range.startOffset, 'start'),
    root,
  );
  const endBlock = closestBlock(boundaryNode(range.endContainer, range.endOffset, 'end'), root);
  if (!startBlock || !endBlock) return null;
  const text = range.toString();
  const from = refineLines(sourceLines, spanOf(startBlock), text);
  const to = endBlock === startBlock ? from : refineLines(sourceLines, spanOf(endBlock), text);
  const startLine = from.start;
  const endLine = Math.max(startLine, endBlock === startBlock ? from.end : to.end);
  return { type: 'LineRangeSelector', startLine, endLine };
}

/** Smallest rendered block that contains `line`, or null. */
export function blockForLine(root: Element, line: number): HTMLElement | null {
  let best: { el: HTMLElement; size: number } | null = null;
  for (const el of root.querySelectorAll<HTMLElement>(`[${LINE_START}]`)) {
    const { start, end } = spanOf(el);
    if (line >= start && line <= end && (!best || end - start < best.size)) {
      best = { el, size: end - start };
    }
  }
  return best?.el ?? null;
}

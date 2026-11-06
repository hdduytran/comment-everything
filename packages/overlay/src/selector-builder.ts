import type { Selector } from '@comment-everything/core/browser';
import { cssEscape } from './dom-helpers.js';
import { fullText, offsetOf } from './text-index.js';

const CONTEXT_CHARS = 32;
const MAX_QUOTE_CHARS = 1000;
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/** One path segment: `tag`, or `tag:nth-of-type(n)` when same-tag siblings exist. */
function cssSegment(node: Element): string {
  const tag = node.localName;
  const same = [...(node.parentElement?.children ?? [])].filter((s) => s.localName === tag);
  return same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag;
}

/** Shortest-first CSS selector that matches exactly `el` (unique id, or tag path from the root). */
export function cssSelectorFor(el: Element): string {
  const doc = el.ownerDocument;
  const isUnique = (sel: string) => {
    try {
      const found = doc.querySelectorAll(sel);
      return found.length === 1 && found[0] === el;
    } catch {
      return false;
    }
  };
  const parts: string[] = [];
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.id) {
      const byId = `#${cssEscape(node.id)}`;
      if (isUnique(byId) || doc.querySelectorAll(byId).length === 1) {
        parts.unshift(byId);
        break;
      }
    }
    parts.unshift(cssSegment(node));
    const candidate = parts.join(' > ');
    if (isUnique(candidate)) return candidate;
    if (node === doc.documentElement) break;
  }
  return parts.join(' > ');
}

function xpathSegment(node: Element): string {
  const name =
    node.namespaceURI === XHTML_NS || node.namespaceURI === null
      ? node.localName
      : `*[local-name()="${node.localName}"]`;
  const same = [...(node.parentElement?.children ?? [])].filter(
    (s) => s.localName === node.localName && s.namespaceURI === node.namespaceURI,
  );
  return same.length > 1 ? `${name}[${same.indexOf(node) + 1}]` : name;
}

/** Absolute XPath (`/html/body/div[2]/p`), or `//*[@id="x"]` shortcuts for simple unique ids. */
export function xpathFor(el: Element): string {
  const parts: string[] = [];
  for (let node: Element | null = el; node; node = node.parentElement) {
    const id = node.id;
    if (
      id &&
      !id.includes('"') &&
      node.ownerDocument.querySelectorAll(`[id="${id}"]`).length === 1
    ) {
      parts.unshift(`/*[@id="${id}"]`);
      return '/' + parts.join('/');
    }
    parts.unshift(xpathSegment(node));
  }
  return '/' + parts.join('/');
}

/** TextQuote + TextPosition for a range, or [] when it covers only whitespace. */
export function quoteSelectorsForRange(range: Range, root: Node): Selector[] {
  const raw = range.toString();
  const exactFull = raw.trim();
  if (!exactFull) return [];
  const lead = raw.length - raw.trimStart().length;
  const start = offsetOf(root, range.startContainer, range.startOffset) + lead;
  const exact = exactFull.slice(0, MAX_QUOTE_CHARS);
  const end = start + exact.length;
  const text = fullText(root);
  return [
    {
      type: 'TextQuoteSelector',
      exact,
      prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start) || undefined,
      suffix: text.slice(end, end + CONTEXT_CHARS) || undefined,
    },
    { type: 'TextPositionSelector', start, end },
  ];
}

/** Selectors for a picked element: CSS + XPath, plus quote/position when it has text. */
export function selectorsForElement(el: Element, root: Node): Selector[] {
  const doc = el.ownerDocument;
  const range = doc.createRange();
  range.selectNodeContents(el);
  return [
    { type: 'CssSelector', value: cssSelectorFor(el) },
    { type: 'XPathSelector', value: xpathFor(el) },
    ...(root.contains(el) ? quoteSelectorsForRange(range, root) : []),
  ];
}

/** Selectors for a text selection: quote + position, plus the CSS selector of its container. */
export function selectorsForRange(range: Range, root: Node): Selector[] {
  const container = range.commonAncestorContainer;
  const element = container instanceof Element ? container : container.parentElement;
  return [
    ...quoteSelectorsForRange(range, root),
    ...(element ? [{ type: 'CssSelector', value: cssSelectorFor(element) } as const] : []),
  ];
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Short preview such as `<p#intro> Welcome to…` or `<img> logo`. */
export function labelForElement(el: Element): string {
  const tag = `<${el.localName}${el.id ? `#${el.id}` : ''}>`;
  const text = clip(el.textContent ?? '', 60) || clip(el.getAttribute('alt') ?? '', 60);
  return text ? `${tag} ${text}` : tag;
}

export const labelForText = (text: string): string => `“${clip(text, 80)}”`;

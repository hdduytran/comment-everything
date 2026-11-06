/** Marks every element the overlay inserts into a page, so pickers and screenshots skip them. */
export const HOST_ATTR = 'data-ce-host';

type Attrs = Record<string, string | undefined>;

/** Create an element with attributes (`class`, `text` are special) and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

/** True when the node is inside an overlay host (light DOM ancestors or retargeted shadow). */
export function isOverlayNode(node: EventTarget | null): boolean {
  return node instanceof Element && node.closest(`[${HOST_ATTR}]`) !== null;
}

/** `CSS.escape` with a fallback for environments without it (jsdom). */
export function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  const isSafe = (c: string) => /[\w-]/.test(c) || c.charCodeAt(0) > 0x9f;
  return [...value]
    .map((c, i) => (i === 0 && /\d/.test(c) ? `\\3${c} ` : isSafe(c) ? c : `\\${c}`))
    .join('');
}

/**
 * Create a shadow-hosting element marked as overlay-owned, appended to `parent`.
 * Styles use a constructable stylesheet when available (works under strict page CSP).
 */
export function createShadowHost(
  doc: Document,
  parent: Element,
  css: string,
  hostStyle = '',
): { host: HTMLElement; shadow: ShadowRoot } {
  const host = doc.createElement('div');
  host.setAttribute(HOST_ATTR, '');
  // Beat page CSS aimed at the host (`div{...}`): reset everything inline, then apply the host's own
  // positioning. Without custom positioning the reset is `!important` so page rules cannot undo it.
  if (hostStyle) host.style.cssText = `all:initial;${hostStyle}`;
  else host.style.setProperty('all', 'initial', 'important');
  const shadow = host.attachShadow({ mode: 'open' });
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    shadow.append(el(doc, 'style', { text: css }));
  }
  parent.append(host);
  return { host, shadow };
}

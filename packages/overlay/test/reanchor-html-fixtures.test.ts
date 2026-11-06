import type { Selector } from '@comment-everything/core/browser';
import { describe, expect, it } from 'vitest';
import { selectorsForElement, selectorsForRange } from '../src/selector-builder.js';
import { resolveSelectors } from '../src/selector-resolver.js';
import { HTML_CASES, type HtmlCase } from './reanchor-html-cases.js';

/** Selectors the overlay would have stored for the pick described by the case. */
function selectorsOnBefore(c: HtmlCase): Selector[] {
  document.body.innerHTML = c.before;
  if ('css' in c.pick) {
    return selectorsForElement(document.querySelector(c.pick.css)!, document.body);
  }
  const { text, nth = 0 } = c.pick;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const at = (n.nodeValue ?? '').indexOf(text);
    if (at === -1 || seen++ < nth) continue;
    const range = document.createRange();
    range.setStart(n, at);
    range.setEnd(n, at + text.length);
    return selectorsForRange(range, document.body);
  }
  throw new Error(`${c.name}: text not found in before`);
}

function passes(c: HtmlCase): boolean {
  const selectors = selectorsOnBefore(c);
  document.body.innerHTML = c.after;
  const target = resolveSelectors(document, document.body, selectors);
  if (c.expect === null) return target === null;
  if (target === null) return false;
  const text = target instanceof Range ? target.toString() : (target.textContent ?? '');
  return text.includes(c.expect);
}

describe('html re-anchoring fixtures', () => {
  for (const c of HTML_CASES) {
    it(c.name, () => expect(passes(c)).toBe(true));
  }

  it('re-anchors at least 90% of the pairs', () => {
    const passed = HTML_CASES.filter(passes).length;
    expect(passed / HTML_CASES.length).toBeGreaterThanOrEqual(0.9);
  });
});

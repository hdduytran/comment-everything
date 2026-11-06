import { beforeEach, describe, expect, it } from 'vitest';
import { cssSelectorFor, xpathFor } from '../src/selector-builder.js';
import { selectorsForElement, selectorsForRange } from '../src/selector-builder.js';
import { resolveSelectors } from '../src/selector-resolver.js';
import { findQuote, rangeFromOffsets } from '../src/text-index.js';

function mount(html: string): void {
  document.body.innerHTML = html;
}
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

describe('selector builder', () => {
  beforeEach(() => {
    mount(`
      <div id="app">
        <p>First paragraph</p>
        <p>Second paragraph with <b>bold</b> text</p>
        <ul><li>one</li><li>two</li><li>two</li></ul>
        <section id="odd:id.1"><span>x</span></section>
      </div>`);
  });

  it('uses a unique id when available and a tag path otherwise', () => {
    expect(cssSelectorFor($('#app'))).toBe('#app');
    const li = document.querySelectorAll('li')[1] as HTMLElement;
    const sel = cssSelectorFor(li);
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(li);
    expect(sel).toContain('nth-of-type(2)');
  });

  it('escapes unusual ids and still round-trips', () => {
    const section = $('section');
    const sel = cssSelectorFor(section);
    expect(document.querySelector(sel)).toBe(section);
  });

  it('builds XPaths that resolve back to the element', () => {
    for (const el of [$('b'), document.querySelectorAll('li')[2] as HTMLElement, $('#app')]) {
      const xp = xpathFor(el);
      const hit = document.evaluate(xp, document, null, 9, null).singleNodeValue;
      expect(hit, xp).toBe(el);
    }
    expect(xpathFor(document.querySelectorAll('li')[2] as HTMLElement)).toMatch(/li\[3\]$/);
  });

  it('element selectors carry css, xpath and a trimmed text quote with context', () => {
    const p = document.querySelectorAll('p')[1] as HTMLElement;
    const sels = selectorsForElement(p, document.body);
    expect(sels.map((s) => s.type)).toEqual([
      'CssSelector',
      'XPathSelector',
      'TextQuoteSelector',
      'TextPositionSelector',
    ]);
    const quote = sels[2];
    expect(quote).toMatchObject({ exact: 'Second paragraph with bold text' });
    const pos = sels[3] as { start: number; end: number };
    expect(document.body.textContent!.slice(pos.start, pos.end)).toBe(
      'Second paragraph with bold text',
    );
  });

  it('text selections produce a quote, offsets and the container css selector', () => {
    const text = $('b').firstChild!;
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 3);
    const sels = selectorsForRange(range, document.body);
    expect(sels[0]).toMatchObject({ type: 'TextQuoteSelector', exact: 'ol' });
    expect(sels[2]).toMatchObject({ type: 'CssSelector' });
    const pos = sels[1] as { start: number; end: number };
    expect(document.body.textContent!.slice(pos.start, pos.end)).toBe('ol');
  });

  it('resolves selectors back to the same element or range', () => {
    const p = document.querySelectorAll('p')[0] as HTMLElement;
    expect(resolveSelectors(document, document.body, selectorsForElement(p, document.body))).toBe(
      p,
    );
    const range = document.createRange();
    range.selectNodeContents($('b'));
    const found = resolveSelectors(
      document,
      document.body,
      selectorsForRange(range, document.body),
    );
    expect((found as Range).toString()).toBe('bold');
  });

  it('disambiguates repeated quotes using prefix and suffix', () => {
    const second = document.querySelectorAll('li')[2] as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(second);
    const [quote] = selectorsForRange(range, document.body);
    const at = findQuote(
      document.body,
      quote as { exact: string; prefix?: string; suffix?: string },
    );
    const hit = rangeFromOffsets(document.body, at!.start, at!.end)!;
    expect(hit.startContainer.parentElement).toBe(second);
  });

  it('whitespace-only ranges yield no text selectors', () => {
    const range = document.createRange();
    range.selectNodeContents($('ul'));
    // ul contains only li elements; its text is "onetwotwo" so there is a quote
    expect(selectorsForRange(range, document.body)[0]).toMatchObject({ exact: 'onetwotwo' });
    const empty = document.createRange();
    empty.setStart($('#app').firstChild!, 0);
    empty.setEnd($('#app').firstChild!, 1);
    expect(selectorsForRange(empty, document.body).map((s) => s.type)).toEqual(['CssSelector']);
  });
});

import { rangeFromOffsets } from '@comment-everything/overlay';
import { describe, expect, it } from 'vitest';
import {
  blockForLine,
  closestBlock,
  lineRangeForElement,
  lineRangeForRange,
  refineLines,
  spanOf,
} from '../src/markdown-line-selectors.js';
import { createMarkdownRenderer } from '../src/markdown-render.js';
import { createUrlResolver, resolveProjectPath } from '../src/markdown-url-resolver.js';

const cfg = { token: 'tok', rootId: 'abc', root: '/proj', source: 'docs/guide.md' };
const SOURCE = [
  '# Title', //                1
  '', //                       2
  'First line of para', //     3
  'second line of para', //    4
  '', //                       5
  '- item one', //             6
  '- item two', //             7
  '', //                       8
  '```js', //                  9
  'const a = 1;', //          10
  'const b = 2;', //          11
  'const c = 3;', //          12
  '```', //                   13
  '', //                      14
  '| a | b |', //             15
  '|---|---|', //             16
  '| 1 | 2 |', //             17
].join('\n');

function render(src = SOURCE): { root: HTMLElement; lines: string[] } {
  const md = createMarkdownRenderer(createUrlResolver(cfg));
  const root = document.createElement('article');
  root.innerHTML = md.render(src);
  document.body.replaceChildren(root);
  return { root, lines: src.split('\n') };
}
const range = (start: Node, so: number, end: Node, eo: number) => {
  const r = document.createRange();
  r.setStart(start, so);
  r.setEnd(end, eo);
  return r;
};

describe('markdown rendering with source line mapping', () => {
  it('tags blocks with 1-based inclusive source lines', () => {
    const { root } = render();
    const span = (sel: string) => spanOf(root.querySelector(sel)!);
    expect(span('h1')).toEqual({ start: 1, end: 1 });
    expect(span('p')).toEqual({ start: 3, end: 4 });
    expect(span('ul')).toEqual({ start: 6, end: 7 });
    expect(span('li:nth-child(2)')).toEqual({ start: 7, end: 7 });
    expect(span('pre code')).toEqual({ start: 9, end: 13 });
    expect(span('table')).toEqual({ start: 15, end: 17 });
    expect(span('tbody tr')).toEqual({ start: 17, end: 17 });
  });

  it('maps an element pick to the right LineRangeSelector', () => {
    const { root } = render();
    expect(lineRangeForElement(root.querySelector('p')!, root)).toEqual({
      type: 'LineRangeSelector',
      startLine: 3,
      endLine: 4,
    });
    // A descendant (inline element / text) resolves to its closest tagged block.
    const td = root.querySelector('tbody td')!;
    expect(lineRangeForElement(td, root)).toMatchObject({ startLine: 17, endLine: 17 });
    expect(closestBlock(root, root)).toBeNull();
  });

  it('narrows a text selection inside a code fence to the lines it touches', () => {
    const { root, lines } = render();
    const codeEl = root.querySelector('pre code')!;
    const from = codeEl.textContent!.indexOf('const b');
    expect(from).toBeGreaterThan(-1);
    // Highlighting splits the text into spans; offsets keep the selection independent of that.
    const sel = rangeFromOffsets(codeEl, from, from + 12)!;
    const lr = lineRangeForRange(sel, root, lines);
    expect(lr).toEqual({ type: 'LineRangeSelector', startLine: 11, endLine: 11 });
  });

  it('maps a selection across two blocks to the span from first to last line', () => {
    const { root, lines } = render();
    const para = root.querySelector('p')!.firstChild as Text;
    const item = root.querySelectorAll('li')[1]!.firstChild as Text;
    const sel = range(para, 0, item, item.data.length);
    expect(lineRangeForRange(sel, root, lines)).toEqual({
      type: 'LineRangeSelector',
      startLine: 3,
      endLine: 7,
    });
  });

  it('refineLines falls back to the whole block when text does not match the source', () => {
    const lines = ['alpha **bold** text', 'next'];
    expect(refineLines(lines, { start: 1, end: 2 }, 'alpha bold text')).toEqual({
      start: 1,
      end: 2,
    });
    expect(refineLines(lines, { start: 1, end: 2 }, 'next')).toEqual({ start: 2, end: 2 });
  });

  it('finds the smallest block for a line (pin placement)', () => {
    const { root } = render();
    expect(blockForLine(root, 7)?.tagName).toBe('LI');
    expect(blockForLine(root, 11)?.tagName).toBe('CODE');
    expect(blockForLine(root, 2)).toBeNull();
  });

  it('renders GFM: tables, task lists, strikethrough, mermaid placeholders, no raw HTML', () => {
    const { root } = render(
      '- [x] done\n- [ ] todo\n\n~~gone~~\n\n```mermaid\ngraph TD; A-->B\n```\n\n<script>alert(1)</script>\n',
    );
    expect(root.querySelectorAll('input[type=checkbox]')).toHaveLength(2);
    expect((root.querySelector('input') as HTMLInputElement).checked).toBe(true);
    expect(root.querySelector('s')?.textContent).toBe('gone');
    expect(root.querySelector('pre.mermaid')?.textContent).toContain('A-->B');
    expect(root.querySelector('pre.mermaid')?.getAttribute('data-line-start')).toBe('6');
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toContain('<script>alert(1)</script>');
  });

  it('highlights fenced code by language', () => {
    const { root } = render('```ts\nconst x: number = 1;\n```\n');
    expect(root.querySelector('code.language-ts .hljs-keyword')).not.toBeNull();
  });
});

describe('url resolution', () => {
  it('resolves relative paths inside the project only', () => {
    expect(resolveProjectPath('docs/guide.md', 'img/a.png')).toBe('docs/img/a.png');
    expect(resolveProjectPath('docs/guide.md', '../README.md#x')).toBe('README.md');
    expect(resolveProjectPath('docs/guide.md', '../../etc/passwd')).toBeNull();
    expect(resolveProjectPath('docs/guide.md', '/top.md')).toBe('top.md');
  });

  it('routes images through scoped files and drops unsafe sources', () => {
    const urls = createUrlResolver(cfg);
    expect(urls.image('pic one.png')).toBe('/s/tok/files/abc/docs/pic%20one.png');
    expect(urls.image('https://x.test/a.png')).toBe('https://x.test/a.png');
    expect(urls.image('http://x.test/a.png')).toBe('');
    expect(urls.image('file:///etc/passwd')).toBe('');
    expect(urls.image('../../outside.png')).toBe('');
  });

  it('opens relative links in the viewer and neutralises other schemes', () => {
    const urls = createUrlResolver(cfg);
    expect(urls.link('other.md#sec')).toEqual({
      href: `/view?path=${encodeURIComponent('/proj/docs/other.md')}#sec`,
      external: false,
    });
    expect(urls.link('https://example.com')).toEqual({
      href: 'https://example.com',
      external: true,
    });
    expect(urls.link('ftp://x')).toEqual({ href: '#', external: false });
    expect(urls.link('#top')).toEqual({ href: '#top', external: false });
  });

  it('renders links with target and rel for external destinations', () => {
    const { root } = render('[site](https://example.com) and [rel](./b.md)');
    const [ext, rel] = [...root.querySelectorAll('a')];
    expect(ext?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(ext?.getAttribute('target')).toBe('_blank');
    expect(rel?.getAttribute('href')).toContain('/view?path=');
  });
});

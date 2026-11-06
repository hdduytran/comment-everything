import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  createComment,
  projectSource,
  reanchorComment,
  type Comment,
} from '../src/index.js';
import { MARKDOWN_CASES, type MarkdownCase } from './reanchor-markdown-cases.js';

/** The comment the viewer would have stored on `before` (quote + line range, or lines only). */
function commentFor(c: MarkdownCase): Comment {
  const proj = projectSource('markdown', c.before);
  const at =
    c.occurrence === 'last' ? proj.text.lastIndexOf(c.target) : proj.text.indexOf(c.target);
  expect(at, `${c.name}: target must exist in before`).toBeGreaterThanOrEqual(0);
  const end = at + c.target.length;
  const lineSel = {
    type: 'LineRangeSelector' as const,
    startLine: proj.lineAt(at),
    endLine: proj.lineAt(end - 1),
  };
  return createComment({
    source: 'doc.md',
    text: 'comment',
    selectors:
      c.mode === 'lines'
        ? [lineSel]
        : [
            lineSel,
            {
              type: 'TextQuoteSelector',
              exact: c.target,
              prefix: proj.text.slice(Math.max(0, at - 32), at),
              suffix: proj.text.slice(end, end + 32),
            },
          ],
  });
}

const reanchored = (c: MarkdownCase): Comment => {
  const comment = commentFor(c);
  const patch = reanchorComment(comment, c.after, c.before);
  return patch ? applyPatch(comment, patch) : comment;
};

/** Run the daemon's pass for one case and report whether the outcome is the expected one. */
function check(c: MarkdownCase): boolean {
  const next = reanchored(c);
  if (c.expect === null) return next.anchorState === 'orphaned';
  const line = next.selectors.find((s) => s.type === 'LineRangeSelector');
  if (next.anchorState === 'orphaned' || line?.type !== 'LineRangeSelector') return false;
  return (c.after.split('\n')[line.startLine - 1] ?? '').includes(c.expect);
}

describe('markdown re-anchoring fixtures', () => {
  for (const c of MARKDOWN_CASES) {
    it(c.name, () => expect(check(c)).toBe(true));
  }

  it('re-anchors at least 90% of the pairs', () => {
    const passed = MARKDOWN_CASES.filter(check).length;
    expect(passed / MARKDOWN_CASES.length).toBeGreaterThanOrEqual(0.9);
  });

  it('marks moved comments as moved and leaves unchanged ones ok', () => {
    expect(reanchored(MARKDOWN_CASES.find((c) => c.name === 'section moved down')!).anchorState).toBe(
      'moved',
    );
    expect(
      reanchored(MARKDOWN_CASES.find((c) => c.name === 'unchanged file stays put')!).anchorState,
    ).toBe('ok');
  });

  it('is idempotent: a second pass over the same text changes nothing', () => {
    const first = reanchored(MARKDOWN_CASES[0]!);
    expect(reanchorComment(first, MARKDOWN_CASES[0]!.after, MARKDOWN_CASES[0]!.after)).toBeNull();
  });

  it('recovers an orphaned comment when the content returns', () => {
    const c = MARKDOWN_CASES.find((x) => x.name === 'section deleted')!;
    const orphan = reanchored(c);
    expect(orphan.anchorState).toBe('orphaned');
    const back = reanchorComment(orphan, c.before, c.after)!;
    expect(applyPatch(orphan, back).anchorState).not.toBe('orphaned');
  });

  it('ignores media sources and judges nothing for CSS-only HTML comments', () => {
    const media = createComment({ source: 'clip.mp4', text: 'x', selectors: [] });
    expect(reanchorComment(media, 'binary')).toBeNull();
    const html = createComment({
      source: 'a.html',
      text: 'x',
      selectors: [{ type: 'CssSelector', value: 'h1' }],
    });
    expect(reanchorComment(html, '<h1>Hi</h1>')).toBeNull();
  });
});

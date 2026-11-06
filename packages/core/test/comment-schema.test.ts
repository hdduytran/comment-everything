import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CommentSchema,
  applyPatch,
  commentJsonSchema,
  createComment,
  mediaFragmentSelector,
  parseComment,
  parseMediaFragment,
} from '../src/index.js';
import { FIXED_NOW, FIXTURE_ROOT } from './helpers.js';

const fixtureDir = path.join(FIXTURE_ROOT, '.comments');

describe('comment schema', () => {
  it('round-trips every committed fixture through parse and JSON', () => {
    const files = readdirSync(fixtureDir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      const raw = JSON.parse(readFileSync(path.join(fixtureDir, f), 'utf8'));
      const parsed = parseComment(raw);
      expect(JSON.parse(JSON.stringify(parsed))).toEqual(raw);
    }
  });

  it('round-trips a created comment with every selector type', () => {
    const c = createComment(
      {
        source: 'a.html',
        text: 'hi',
        selectors: [
          { type: 'TextQuoteSelector', exact: 'x', prefix: 'p', suffix: 's' },
          { type: 'TextPositionSelector', start: 1, end: 4 },
          { type: 'CssSelector', value: 'a > b' },
          { type: 'XPathSelector', value: '//a' },
          { type: 'LineRangeSelector', startLine: 1, endLine: 2 },
          mediaFragmentSelector(1.5, 3),
          { type: 'ScreenshotSelector', rect: { x: 0, y: 1, width: 2, height: 3 }, asset: 'assets/a.png' },
        ],
      },
      { now: FIXED_NOW, id: 'abc', batchId: 'b1' },
    );
    expect(CommentSchema.parse(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(c.status).toBe('open');
    expect(c.schemaVersion).toBe(1);
  });

  it('rejects unknown schema versions with a clear error', () => {
    expect(() => parseComment({ schemaVersion: 99 })).toThrow(/schemaVersion 99/);
  });

  it('rejects traversal-prone ids and bad selectors', () => {
    const base = createComment({ source: 'a', text: '' });
    expect(() => parseComment({ ...base, id: '../evil' })).toThrow();
    expect(() => parseComment({ ...base, selectors: [{ type: 'LineRangeSelector', startLine: 5, endLine: 2 }] })).toThrow();
    expect(() => parseComment({ ...base, selectors: [{ type: 'FragmentSelector', value: 'x=1' }] })).toThrow();
  });

  it('parses media fragments and applies patches', () => {
    expect(parseMediaFragment(mediaFragmentSelector(1.25, 9))).toEqual({ start: 1.25, end: 9 });
    const c = createComment({ source: 'a', text: 't' }, { now: FIXED_NOW });
    const p = applyPatch(c, { status: 'resolved', resolution: 'done' }, new Date('2026-11-07T00:00:00Z'));
    expect(p.status).toBe('resolved');
    expect(p.updatedAt).toBe('2026-11-07T00:00:00.000Z');
    expect(() => applyPatch(c, { id: 'x' } as never)).toThrow();
  });

  it('keeps the published JSON Schema in sync with the zod schema', () => {
    const file = path.join(__dirname, '..', 'schema', 'comment.schema.json');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(JSON.stringify(commentJsonSchema())));
  });
});

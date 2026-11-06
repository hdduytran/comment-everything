import { describe, expect, it } from 'vitest';
import { fuzzyFindQuote } from '../src/index.js';

describe('fuzzyFindQuote', () => {
  const text = 'Alpha beta gamma. The quick brown fox jumps over the lazy dog. Omega.';

  it('finds exact quotes', () => {
    const m = fuzzyFindQuote(text, { exact: 'quick brown fox' })!;
    expect(text.slice(m.start, m.end)).toBe('quick brown fox');
    expect(m.similarity).toBe(1);
  });

  it('finds an edited quote', () => {
    const m = fuzzyFindQuote(text, { exact: 'The quick brown fox leaps over the lazy dog' })!;
    expect(text.slice(m.start, m.end)).toContain('jumps over the lazy dog');
  });

  it('uses prefix and suffix to pick between exact duplicates', () => {
    const t = 'one: same words. two: same words. three.';
    const m = fuzzyFindQuote(t, { exact: 'same words', prefix: 'two: ', suffix: '. three' })!;
    expect(m.start).toBe(t.lastIndexOf('same words'));
  });

  it('rejects unrelated text and empty input', () => {
    expect(fuzzyFindQuote(text, { exact: 'completely different sentence here' })).toBeNull();
    expect(fuzzyFindQuote('', { exact: 'x' })).toBeNull();
    expect(fuzzyFindQuote(text, { exact: '' })).toBeNull();
  });
});

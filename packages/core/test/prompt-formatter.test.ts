import { describe, expect, it } from 'vitest';
import { CommentStore, createComment, formatPrompt } from '../src/index.js';
import { FIXTURE_ROOT } from './helpers.js';

describe('formatPrompt', () => {
  it('matches the snapshot for the fixture comments', async () => {
    const comments = await new CommentStore(FIXTURE_ROOT).list();
    expect(formatPrompt(comments)).toMatchSnapshot();
  });

  it('handles the empty list', () => {
    expect(formatPrompt([])).toBe('No comments.\n');
  });

  it('prefixes asset paths with the given base, default .comments/', () => {
    const c = createComment(
      { source: 'https://x.test/', text: 'hi', assets: ['assets/a.png'] },
      { id: 'c1', batchId: 'b1', now: new Date('2026-01-01T00:00:00Z') },
    );
    expect(formatPrompt([c])).toContain('`.comments/assets/a.png`');
    expect(formatPrompt([c], { assetPrefix: '' })).toContain('`assets/a.png`');
  });
});

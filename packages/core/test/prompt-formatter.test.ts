import { describe, expect, it } from 'vitest';
import { CommentStore, formatPrompt } from '../src/index.js';
import { FIXTURE_ROOT } from './helpers.js';

describe('formatPrompt', () => {
  it('matches the snapshot for the fixture comments', async () => {
    const comments = await new CommentStore(FIXTURE_ROOT).list();
    expect(formatPrompt(comments)).toMatchSnapshot();
  });

  it('handles the empty list', () => {
    expect(formatPrompt([])).toBe('No comments.\n');
  });
});

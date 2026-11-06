import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, json, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.cleanup());

const post = (body: unknown) =>
  env.api('/comments', { method: 'POST', body: JSON.stringify(body) });
const web = (text: string) => ({
  source: 'http://localhost:3000/page',
  text,
  selectors: [{ type: 'CssSelector', value: 'h1' }],
});

describe('web page comments with a mapped project root', () => {
  it('stores URL-source comments in the given project root', async () => {
    const res = await post({ root: env.project, comments: [web('mapped')] });
    expect(res.status).toBe(201);
    const batch = await json(res);
    expect(batch.comments[0].root).toBe(env.project);
    const files = await readdir(path.join(env.project, '.comments'));
    expect(files.some((f) => f.endsWith('.json'))).toBe(true);
  });

  it('lists them for that source and root', async () => {
    const q = new URLSearchParams({ source: 'http://localhost:3000/page', root: env.project });
    const body = await json(await env.api(`/comments?${q}`));
    expect(body.comments.map((c: { text: string }) => c.text)).toContain('mapped');
  });

  it('keeps using the per-host data folder when no root is given', async () => {
    const res = await post({ comments: [web('unmapped')] });
    const batch = await json(res);
    expect(batch.comments[0].root).toContain(path.join('.comment-everything', 'localhost_3000'));
  });
});

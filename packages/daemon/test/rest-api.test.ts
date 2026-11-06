import { readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestEnv,
  drainBatches,
  json,
  rawRequest,
  sampleComment,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.cleanup());

const post = (p: string, body: unknown) =>
  env.api(p, { method: 'POST', body: JSON.stringify(body) });

describe('REST comments', () => {
  it('creates a batch, lists, filters, fetches and patches', async () => {
    const res = await post('/comments', {
      root: env.project,
      comments: [sampleComment('index.html', 'one'), sampleComment('docs/guide.md', 'two')],
    });
    expect(res.status).toBe(201);
    const batch = await json(res);
    expect(batch.comments).toHaveLength(2);
    expect(new Set(batch.comments.map((c: { batchId: string }) => c.batchId)).size).toBe(1);
    const [first] = batch.comments;

    const files = await readdir(path.join(env.project, '.comments'));
    expect(files.filter((f) => f.endsWith('.json'))).toHaveLength(2);

    const all = await json(await env.api('/comments'));
    expect(all.comments).toHaveLength(2);
    const filtered = await json(await env.api('/comments?source=docs/guide.md&status=open'));
    expect(filtered.comments.map((c: { text: string }) => c.text)).toEqual(['two']);

    expect((await json(await env.api(`/comments/${first.id}`))).text).toBe(first.text);

    const patched = await env.api(`/comments/${first.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'resolved', resolution: 'done' }),
    });
    expect(patched.status).toBe(200);
    expect(await json(patched)).toMatchObject({ status: 'resolved', resolution: 'done' });
    expect((await json(await env.api('/comments?status=resolved'))).comments).toHaveLength(1);
  });

  it('rejects malformed input with 400 and unknown ids with 404', async () => {
    expect((await post('/comments', { root: env.project, comments: [] })).status).toBe(400);
    expect((await post('/comments', { root: env.project, comments: [{ text: 'x' }] })).status).toBe(
      400,
    );
    expect((await env.api('/comments', { method: 'POST', body: '{nope' })).status).toBe(400);
    expect((await post('/comments', { comments: [sampleComment()] })).status).toBe(400); // root required
    expect(
      (await post('/comments', { root: env.project, comments: [sampleComment('../x.md')] })).status,
    ).toBe(400);
    expect(
      (await post('/comments', { root: env.project, comments: [sampleComment('/etc/passwd')] }))
        .status,
    ).toBe(400);
    expect((await env.api('/comments/nope')).status).toBe(404);
    expect((await env.api('/comments/..%2Fx')).status).not.toBe(200);
    expect(
      (await env.api('/comments/nope', { method: 'PATCH', body: '{"status":"open"}' })).status,
    ).toBe(404);
    expect((await env.api('/comments/nope', { method: 'PATCH', body: '{"id":"x"}' })).status).toBe(
      400,
    );
  });

  it('stores web-page comments under the per-host folder in home', async () => {
    const res = await post('/comments', {
      comments: [sampleComment('http://localhost:3000/page', 'web')],
    });
    expect(res.status).toBe(201);
    const [c] = (await json(res)).comments;
    expect(c.root).toBe(path.join(env.home, '.comment-everything', 'localhost_3000'));
    expect((await readdir(path.join(c.root, '.comments'))).some((f) => f === `${c.id}.json`)).toBe(
      true,
    );
  });

  it('refuses to register overly broad or missing roots', async () => {
    expect((await post('/roots', { root: '/' })).status).toBe(400);
    expect((await post('/roots', { root: env.home })).status).toBe(400);
    expect((await post('/roots', { root: 'relative/dir' })).status).toBe(400);
    expect((await post('/roots', { root: path.join(env.project, 'missing') })).status).toBe(400);
    expect((await post('/roots', { root: env.project })).status).toBe(201);
  });
});

describe('batches (wait_for_comments backing)', () => {
  it('returns 204 on timeout and a queued batch immediately afterwards', async () => {
    await drainBatches(env);
    expect((await env.api('/batches/next?timeoutSec=1')).status).toBe(204);
    await post('/comments', {
      root: env.project,
      comments: [sampleComment('index.html', 'queued')],
    });
    const res = await env.api('/batches/next?timeoutSec=1');
    expect(res.status).toBe(200);
    expect((await json(res)).comments[0].text).toBe('queued');
    expect((await env.api('/batches/next?timeoutSec=1')).status).toBe(204); // claimed once
  });

  it('wakes a waiting long-poll when a batch is sent', async () => {
    await drainBatches(env);
    const waiting = env.api('/batches/next?timeoutSec=10');
    await new Promise((r) => setTimeout(r, 100));
    await post('/comments', { root: env.project, comments: [sampleComment('index.html', 'live')] });
    const res = await waiting;
    expect(res.status).toBe(200);
    expect((await json(res)).comments[0].text).toBe('live');
  });
});

describe('SSE /events', () => {
  it('streams created and batch events', async () => {
    const ac = new AbortController();
    const res = await fetch(`${env.daemon.url}/events?token=${env.daemon.token}`, {
      signal: ac.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = '';
    const pump = (async () => {
      while (!text.includes('batch.sent')) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value);
      }
    })();
    await new Promise((r) => setTimeout(r, 100));
    await post('/comments', { root: env.project, comments: [sampleComment('index.html', 'sse')] });
    await pump;
    ac.abort();
    expect(text).toContain('event: comment.created');
    expect(text).toContain('event: batch.sent');
  });
});

describe('GET /view placeholder', () => {
  it('embeds the token and source for a registered file', async () => {
    const file = path.join(env.project, 'docs', 'guide.md');
    const res = await rawRequest(env.daemon.port, `/view?path=${encodeURIComponent(file)}`);
    expect(res.status).toBe(200);
    expect(res.headers['x-frame-options']).toBe('DENY');
    const cfg = JSON.parse(
      /<script type="application\/json" id="ce-config">(.*?)<\/script>/s.exec(res.body)![1]!,
    );
    expect(cfg).toMatchObject({
      token: env.daemon.token,
      rootId: env.rootId,
      source: 'docs/guide.md',
    });
  });

  it('403 outside registered roots (incl. via symlink) and rejects foreign origins', async () => {
    const secret = path.join(env.project, '..', 'secret.txt');
    expect(
      (await rawRequest(env.daemon.port, `/view?path=${encodeURIComponent(secret)}`)).status,
    ).toBe(403);
    await symlink(secret, path.join(env.project, 'sneaky.md'));
    const sneaky = path.join(env.project, 'sneaky.md');
    expect(
      (await rawRequest(env.daemon.port, `/view?path=${encodeURIComponent(sneaky)}`)).status,
    ).toBe(403);
    const origin = await rawRequest(env.daemon.port, '/view?path=/x', {
      origin: 'https://evil.example',
    });
    expect(origin.status).toBe(403);
  });
});

import { createComment } from '@comment-everything/core/browser';
import { describe, expect, it, vi } from 'vitest';
import { bytesToBase64 } from '../src/base64-bytes.js';
import { memoryStore } from '../src/key-value-store.js';
import { memoryAssetStore } from '../src/local-asset-store.js';
import {
  CLAUDE_NEW_CHAT_URL,
  handleStandaloneRequest,
  type StandaloneWorkerDeps,
} from '../src/standalone-worker-handlers.js';
import { PNG_BYTES } from './png-fixture.js';

const now = new Date(2026, 10, 6, 15, 7, 42);

function deps() {
  const saved: { filename: string; url: string }[] = [];
  const d: StandaloneWorkerDeps = {
    store: memoryStore(),
    assets: memoryAssetStore(),
    downloads: {
      download: async (o) => saved.push(o),
      search: async ({ id }) => [
        { filename: `/home/me/Downloads/${saved[id - 1]!.filename}`, state: 'complete' },
      ],
    },
    openTab: vi.fn(async () => undefined),
    now: () => now,
  };
  return { d, saved };
}

const comments = (assets: string[] = []) => [
  createComment(
    { source: 'https://example.com/a', text: 'Tweak', assets },
    { id: 'c1', batchId: 'b', now },
  ),
];

describe('standalone worker requests', () => {
  it('stores a PNG, returns it, and deletes it', async () => {
    const { d } = deps();
    const put = await handleStandaloneRequest(
      { type: 'ce:asset-put', body: bytesToBase64(PNG_BYTES) },
      d,
    );
    expect(put).toMatchObject({ ok: true, path: expect.stringMatching(/^assets\/.+\.png$/) });
    const path = (put as { path: string }).path;
    const got = await handleStandaloneRequest({ type: 'ce:asset-get', path }, d);
    expect(got).toEqual({ ok: true, body: bytesToBase64(PNG_BYTES) });
    await handleStandaloneRequest({ type: 'ce:asset-delete', path }, d);
    expect(await handleStandaloneRequest({ type: 'ce:asset-get', path }, d)).toEqual({
      ok: true,
      body: null,
    });
  });

  it('refuses non-PNG data and path tricks', async () => {
    const { d } = deps();
    await expect(
      handleStandaloneRequest({ type: 'ce:asset-put', body: btoa('not a png at all') }, d),
    ).rejects.toThrow(/PNG/);
    await expect(
      handleStandaloneRequest({ type: 'ce:asset-get', path: 'assets/../../x.png' }, d),
    ).rejects.toThrow(/Invalid asset path/);
  });

  it('exports into comment-everything/<host>/<stamp>/ and reports the comments.md location', async () => {
    const { d, saved } = deps();
    const put = (await handleStandaloneRequest(
      { type: 'ce:asset-put', body: bytesToBase64(PNG_BYTES) },
      d,
    )) as { path: string };
    const reply = await handleStandaloneRequest(
      { type: 'ce:export', host: 'example.com', comments: comments([put.path]) },
      d,
    );
    expect(reply).toEqual({
      ok: true,
      count: 1,
      where: '~/Downloads/comment-everything/example.com/2026-11-06-1507/comments.md',
    });
    expect(saved.map((s) => s.filename).sort()).toEqual([
      `comment-everything/example.com/2026-11-06-1507/${put.path}`,
      'comment-everything/example.com/2026-11-06-1507/comments.json',
      'comment-everything/example.com/2026-11-06-1507/comments.md',
    ]);
  });

  it('puts a second export of the same minute in its own folder', async () => {
    const { d } = deps();
    const req = { type: 'ce:export' as const, host: 'example.com', comments: comments() };
    await handleStandaloneRequest(req, d);
    const second = (await handleStandaloneRequest(req, d)) as { where: string };
    expect(second.where).toContain('/2026-11-06-1507-2/comments.md');
  });

  it('validates what it is asked to export', async () => {
    const { d } = deps();
    await expect(
      handleStandaloneRequest({ type: 'ce:export', host: 'h', comments: [] }, d),
    ).rejects.toThrow();
    await expect(
      handleStandaloneRequest(
        { type: 'ce:export', host: 'h', comments: [{ text: 'no schema' }] },
        d,
      ),
    ).rejects.toThrow();
  });

  it('opens a blank claude.ai chat and ignores daemon-mode requests', async () => {
    const { d } = deps();
    await handleStandaloneRequest({ type: 'ce:open-claude' }, d);
    expect(d.openTab).toHaveBeenCalledWith('https://claude.ai/new');
    expect(CLAUDE_NEW_CHAT_URL).not.toContain('?');
    expect(await handleStandaloneRequest({ type: 'ce:capture' }, d)).toBeUndefined();
  });
});

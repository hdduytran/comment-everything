import type { CommentInput } from '@comment-everything/core/browser';
import { describe, expect, it } from 'vitest';
import { memoryStore } from '../src/key-value-store.js';
import { memoryAssetStore } from '../src/local-asset-store.js';
import {
  createLocalTransport,
  listAllLocalComments,
  listMigratable,
  removeLocalComments,
} from '../src/local-comment-store.js';
import { pngBlob } from './png-fixture.js';

const PAGE = 'https://example.com/docs';
const input = (text: string, extra: Partial<CommentInput> = {}): CommentInput => ({
  source: PAGE,
  text,
  selectors: [{ type: 'CssSelector', value: '#title' }],
  ...extra,
});

function setup(source = PAGE) {
  const store = memoryStore();
  const assets = memoryAssetStore();
  const transport = createLocalTransport({ source, store, assets });
  return { store, assets, transport };
}

describe('local comment transport', () => {
  it('saves a batch with the shared schema and lists it back for the same page only', async () => {
    const { transport, store, assets } = setup();
    const { batchId, comments } = await transport.sendBatch([input('one'), input('two')]);
    expect(comments).toHaveLength(2);
    expect(comments[0]).toMatchObject({
      schemaVersion: 1,
      source: PAGE,
      text: 'one',
      status: 'open',
      batchId,
    });
    expect(await transport.listComments()).toEqual(comments);

    const other = createLocalTransport({ source: 'https://example.com/other', store, assets });
    expect(await other.listComments()).toEqual([]);
  });

  it('rejects invalid input instead of storing it', async () => {
    const { transport } = setup();
    await expect(transport.sendBatch([])).rejects.toThrow(/batch/);
    await expect(transport.sendBatch([input('x'.repeat(50_001))])).rejects.toThrow();
    await expect(transport.sendBatch([{ ...input('a'), source: '' }])).rejects.toThrow();
    expect(await transport.listComments()).toEqual([]);
  });

  it('ignores stored entries that no longer match the schema', async () => {
    const { transport, store } = setup();
    const [good] = (await transport.sendBatch([input('keep')])).comments;
    await store.set(`localComments:${PAGE}`, [good, { id: 'bad', text: 5 }, 'junk']);
    expect(await transport.listComments()).toEqual([good]);
  });

  it('lets the user mark a comment resolved and reopen it, and announces the change', async () => {
    const { transport } = setup();
    const events: string[] = [];
    transport.subscribe((e) => events.push(e.type));
    const [c] = (await transport.sendBatch([input('fix me')])).comments;
    const done = await transport.updateStatus!(c!.id, 'resolved');
    expect(done.status).toBe('resolved');
    expect((await transport.listComments())[0]!.status).toBe('resolved');
    expect((await transport.updateStatus!(c!.id, 'open')).status).toBe('open');
    expect(events).toEqual(['comment.created', 'comment.updated', 'comment.updated']);
    await expect(transport.updateStatus!('missing', 'resolved')).rejects.toThrow(/not found/);
  });

  it('deletes a comment together with its screenshots', async () => {
    const { transport, assets } = setup();
    const asset = await transport.uploadAsset(pngBlob());
    expect(asset).toMatch(/^assets\/[\w-]+\.png$/);
    const [c] = (await transport.sendBatch([input('with shot', { assets: [asset] })])).comments;
    expect(await assets.get(asset)).not.toBeNull();
    await transport.deleteComment!(c!.id);
    expect(await transport.listComments()).toEqual([]);
    expect(await assets.get(asset)).toBeNull();
  });

  it('stores screenshots as blobs and only accepts PNG images within the size cap', async () => {
    const { transport, assets } = setup();
    const path = await transport.uploadAsset(pngBlob());
    const back = await assets.get(path);
    expect(back?.size).toBe(pngBlob().size);
    await expect(
      transport.uploadAsset(new Blob(['<svg/>'], { type: 'image/svg+xml' })),
    ).rejects.toThrow(/PNG/);
    await expect(transport.uploadAsset(new Blob([]))).rejects.toThrow(/between/);
    await expect(assets.get('../secret')).rejects.toThrow(/Invalid asset path/);
  });

  it('keeps concurrent saves from overwriting each other', async () => {
    const { transport } = setup();
    await Promise.all([1, 2, 3, 4, 5].map((n) => transport.sendBatch([input(`c${n}`)])));
    expect(await transport.listComments()).toHaveLength(5);
  });

  it('builds the copy-prompt text from saved comments (assets next to the file)', async () => {
    const { transport } = setup();
    const asset = await transport.uploadAsset(pngBlob());
    const { comments } = await transport.sendBatch([input('Look here', { assets: [asset] })]);
    const { formatPrompt } = await import('@comment-everything/core/browser');
    const prompt = formatPrompt(comments, { assetPrefix: '' });
    expect(prompt).toContain('# Review comments (1)');
    expect(prompt).toContain(`\`${asset}\``);
    expect(prompt).toContain('> Look here');
  });
});

describe('migration candidates', () => {
  it('lists unresolved comments of one origin and removes them with their screenshots', async () => {
    const { store, assets, transport } = setup();
    const asset = await transport.uploadAsset(pngBlob());
    const a = (await transport.sendBatch([input('a', { assets: [asset] })])).comments[0]!;
    const b = (await transport.sendBatch([input('b')])).comments[0]!;
    await transport.updateStatus!(b.id, 'resolved');
    const elsewhere = createLocalTransport({ source: 'https://other.test/x', store, assets });
    await elsewhere.sendBatch([{ source: 'https://other.test/x', text: 'c' }]);

    expect(await listAllLocalComments(store)).toHaveLength(3);
    expect((await listMigratable(store, 'https://example.com')).map((c) => c.text)).toEqual(['a']);

    await removeLocalComments(store, assets, [a]);
    expect((await listAllLocalComments(store)).map((c) => c.text).sort()).toEqual(['b', 'c']);
    expect(await assets.get(asset)).toBeNull();
  });
});

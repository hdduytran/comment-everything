import type { CommentInput } from '@comment-everything/core/browser';
import { describe, expect, it, vi } from 'vitest';
import { memoryStore } from '../src/key-value-store.js';
import { memoryAssetStore } from '../src/local-asset-store.js';
import {
  createLocalTransport,
  listAllLocalComments,
  listMigratable,
  removeLocalComments,
} from '../src/local-comment-store.js';
import { migrateLocalComments } from '../src/migrate-local-comments.js';
import { pngBlob } from './png-fixture.js';

const SRC = 'http://localhost:3000/page';

async function seed() {
  const store = memoryStore();
  const assets = memoryAssetStore();
  const local = createLocalTransport({ source: SRC, store, assets });
  const shot = await local.uploadAsset(pngBlob());
  await local.sendBatch([
    {
      source: SRC,
      text: 'with screenshot',
      selectors: [
        { type: 'CssSelector', value: '#a' },
        { type: 'ScreenshotSelector', rect: { x: 0, y: 0, width: 5, height: 5 }, asset: shot },
      ],
      assets: [shot],
    },
    { source: SRC, text: 'plain' },
  ]);
  return { store, assets, shot };
}

describe('moving local comments to a project', () => {
  it('uploads screenshots, rewrites references, sends one batch and clears the local copies', async () => {
    const { store, assets } = await seed();
    const sent: CommentInput[][] = [];
    const uploads: string[] = [];
    const daemon = {
      uploadAsset: vi.fn(async () => {
        uploads.push('x');
        return 'assets/remote-1.png';
      }),
      sendBatch: vi.fn(async (inputs: CommentInput[]) => {
        sent.push(inputs);
        return { batchId: 'b', comments: [] };
      }),
    };
    const comments = await listMigratable(store, 'http://localhost:3000');
    const moved = await migrateLocalComments({
      comments,
      assets,
      daemon,
      forget: (done) => removeLocalComments(store, assets, done),
    });

    expect(moved).toBe(2);
    expect(uploads).toHaveLength(1);
    expect(sent).toHaveLength(1);
    const withShot = sent[0]!.find((c) => c.text === 'with screenshot')!;
    expect(withShot.source).toBe(SRC);
    expect(withShot.assets).toEqual(['assets/remote-1.png']);
    expect(withShot.selectors).toContainEqual(
      expect.objectContaining({ type: 'ScreenshotSelector', asset: 'assets/remote-1.png' }),
    );
    expect(await listAllLocalComments(store)).toEqual([]);
    expect(assets.size()).toBe(0);
  });

  it('keeps every local comment when the daemon refuses the batch', async () => {
    const { store, assets } = await seed();
    const daemon = {
      uploadAsset: async () => 'assets/r.png',
      sendBatch: async (): Promise<never> => {
        throw new Error('Daemon responded 500');
      },
    };
    const comments = await listMigratable(store, 'http://localhost:3000');
    await expect(
      migrateLocalComments({ comments, assets, daemon, forget: vi.fn() }),
    ).rejects.toThrow(/500/);
    expect(await listAllLocalComments(store)).toHaveLength(2);
  });

  it('drops a reference to a screenshot that no longer exists but keeps the comment', async () => {
    const { store, assets, shot } = await seed();
    await assets.delete(shot);
    const sent: CommentInput[][] = [];
    const daemon = {
      uploadAsset: vi.fn(),
      sendBatch: async (inputs: CommentInput[]) => (
        sent.push(inputs),
        { batchId: 'b', comments: [] }
      ),
    };
    const comments = await listMigratable(store, 'http://localhost:3000');
    await migrateLocalComments({ comments, assets, daemon, forget: async () => undefined });
    const c = sent[0]!.find((x) => x.text === 'with screenshot')!;
    expect(c.assets).toEqual([]);
    expect(c.selectors).toEqual([{ type: 'CssSelector', value: '#a' }]);
    expect(daemon.uploadAsset).not.toHaveBeenCalled();
  });
});

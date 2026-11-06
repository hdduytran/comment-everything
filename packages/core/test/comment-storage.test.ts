import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommentStore, createComment, writeFileAtomic, type StorageChange } from '../src/index.js';
import { FIXTURE_ROOT, FIXED_NOW, withTempDir } from './helpers.js';

describe('CommentStore', () => {
  it('writes, reads, lists, filters and deletes', async () => {
    await withTempDir(async (dir) => {
      const store = new CommentStore(dir);
      const a = createComment({ source: 'a.md', text: 'one' }, { now: FIXED_NOW, id: 'a' });
      const b = createComment({ source: 'b.md', text: 'two' }, { now: new Date(FIXED_NOW.getTime() + 1000), id: 'b' });
      await store.write(a);
      await store.write(b);
      expect(await store.read('a')).toEqual(a);
      expect((await store.list()).map((c) => c.id)).toEqual(['a', 'b']);
      expect((await store.list({ source: 'b.md' })).map((c) => c.id)).toEqual(['b']);
      expect(await store.list({ status: 'resolved' })).toEqual([]);
      expect(await store.read('missing')).toBeNull();
      expect(await store.delete('a')).toBe(true);
      expect(await store.delete('a')).toBe(false);
    });
  });

  it('lists the committed fixtures', async () => {
    const list = await new CommentStore(FIXTURE_ROOT).list();
    expect(list.map((c) => c.id)).toEqual(['fixture-html-quote', 'fixture-md-lines', 'fixture-video-range']);
  });

  it('refuses ids that could escape the comments directory', async () => {
    await withTempDir(async (dir) => {
      await expect(new CommentStore(dir).read('../../etc/passwd')).rejects.toThrow(/Invalid comment id/);
    });
  });

  it('never exposes a partial file under concurrent atomic writes', async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, 'target.json');
      const payloads = Array.from({ length: 40 }, (_, i) => JSON.stringify({ n: i, pad: 'x'.repeat(50_000) }));
      let stop = false;
      let torn = 0;
      const reader = (async () => {
        while (!stop) {
          try {
            JSON.parse(await readFile(file, 'utf8'));
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') torn++;
          }
        }
      })();
      await Promise.all(payloads.map((p) => writeFileAtomic(file, p)));
      stop = true;
      await reader;
      expect(torn).toBe(0);
      expect(JSON.parse(await readFile(file, 'utf8')).n).toBeGreaterThanOrEqual(0);
      expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    });
  });

  it('serializes concurrent updates of one comment without losing any', async () => {
    await withTempDir(async (dir) => {
      const store = new CommentStore(dir);
      await store.write(createComment({ source: 's', text: 't' }, { id: 'c1' }));
      await Promise.all([
        store.update('c1', { status: 'in_progress' }),
        store.update('c1', { resolution: 'note' }),
        store.update('c1', { text: 'edited' }),
      ]);
      const c = await store.read('c1');
      expect(c).toMatchObject({ status: 'in_progress', resolution: 'note', text: 'edited' });
    });
  });

  it('skips corrupt files when listing and reports them', async () => {
    await withTempDir(async (dir) => {
      const store = new CommentStore(dir);
      await store.write(createComment({ source: 's', text: 't' }, { id: 'ok' }));
      await writeFile(path.join(store.commentsDir, 'bad.json'), '{not json');
      const skipped: string[] = [];
      expect((await store.list({}, (f) => skipped.push(f))).map((c) => c.id)).toEqual(['ok']);
      expect(skipped).toEqual(['bad.json']);
    });
  });

  it('emits change events for writes made on disk', async () => {
    await withTempDir(async (dir) => {
      const store = new CommentStore(dir);
      await mkdir(store.commentsDir, { recursive: true });
      const events: StorageChange[] = [];
      const stop = store.watch((e) => events.push(e));
      await new Promise((r) => setTimeout(r, 200));
      await store.write(createComment({ source: 's', text: 't' }, { id: 'w1' }));
      for (let i = 0; i < 50 && events.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
      await stop();
      expect(events[0]).toMatchObject({ type: 'add', id: 'w1' });
    });
  });

  it('stores assets by safe name only', async () => {
    await withTempDir(async (dir) => {
      const store = new CommentStore(dir);
      expect(await store.writeAsset('k.jpg', new Uint8Array([1, 2]))).toBe('assets/k.jpg');
      await expect(store.writeAsset('../k.jpg', new Uint8Array())).rejects.toThrow(/Invalid asset name/);
    });
  });
});

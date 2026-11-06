import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DaemonAlreadyRunningError,
  JobQueue,
  acquireLock,
  isProcessAlive,
  loadOrCreateToken,
  lockfilePath,
  readLock,
  startDaemon,
} from '../src/index.js';

async function withHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(path.join(tmpdir(), 'ce-lock-'));
  try {
    return await fn(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

describe('daemon lockfile', () => {
  it('persists a 0600 token that is stable across calls', async () => {
    await withHome(async (home) => {
      const a = await loadOrCreateToken(home);
      expect(a.length).toBeGreaterThanOrEqual(32);
      expect(await loadOrCreateToken(home)).toBe(a);
      expect((await stat(path.join(home, '.comment-everything', 'token'))).mode & 0o777).toBe(
        0o600,
      );
    });
  });

  it('replaces a stale lock whose pid is dead', async () => {
    await withHome(async (home) => {
      const dead = { pid: 2 ** 22 - 1, port: 1, token: 't', startedAt: new Date().toISOString() };
      expect(isProcessAlive(dead.pid)).toBe(false);
      expect(await acquireLock(dead, home)).toEqual({ ok: true });
      const mine = { ...dead, pid: process.pid, port: 2 };
      expect(await acquireLock(mine, home)).toEqual({ ok: true });
      expect((await readLock(home))?.port).toBe(2);
    });
  });

  it('treats a corrupt lockfile as stale', async () => {
    await withHome(async (home) => {
      await loadOrCreateToken(home);
      await writeFile(lockfilePath(home), 'garbage');
      const lock = { pid: process.pid, port: 3, token: 't', startedAt: new Date().toISOString() };
      expect(await acquireLock(lock, home)).toEqual({ ok: true });
    });
  });

  it('a second daemon reuses the first instead of starting', async () => {
    await withHome(async (home) => {
      const first = await startDaemon({ port: 0, home, watch: false });
      try {
        await expect(startDaemon({ port: 0, home, watch: false })).rejects.toBeInstanceOf(
          DaemonAlreadyRunningError,
        );
        const lock = await readLock(home);
        expect(lock).toMatchObject({ pid: process.pid, port: first.port, token: first.token });
      } finally {
        await first.stop();
      }
      expect(await readLock(home)).toBeNull(); // lock released on stop
    });
  });

  it('fails with EADDRINUSE instead of picking another port', async () => {
    await withHome(async (home) => {
      const first = await startDaemon({ port: 0, home, watch: false, useLockfile: false });
      try {
        await expect(
          startDaemon({ port: first.port, home, watch: false, useLockfile: false }),
        ).rejects.toMatchObject({
          code: 'EADDRINUSE',
        });
      } finally {
        await first.stop();
      }
    });
  });
});

describe('JobQueue', () => {
  it('runs jobs FIFO with bounded concurrency and records results', async () => {
    const q = new JobQueue(1);
    const order: number[] = [];
    q.register<number, number>('double', async (n) => {
      order.push(n);
      await new Promise((r) => setTimeout(r, 10));
      return n * 2;
    });
    const jobs = [1, 2, 3].map((n) => q.enqueue('double', n));
    const done = await Promise.all(jobs.map((j) => q.waitFor(j.id)));
    expect(done.map((j) => j.result)).toEqual([2, 4, 6]);
    expect(order).toEqual([1, 2, 3]);
    expect(done.every((j) => j.status === 'succeeded' && j.finishedAt)).toBe(true);
  });

  it('captures handler failures and rejects unknown types', async () => {
    const q = new JobQueue();
    q.register('boom', async () => {
      throw new Error('ffmpeg missing');
    });
    const done = await q.waitFor(q.enqueue('boom', {}).id);
    expect(done).toMatchObject({ status: 'failed', error: 'ffmpeg missing' });
    expect(() => q.enqueue('nope', {})).toThrow(/Unknown job type/);
    expect(() => q.register('boom', async () => 1)).toThrow(/already registered/);
  });
});

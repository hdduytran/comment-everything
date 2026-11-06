import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/example-project', import.meta.url));
export const FIXED_NOW = new Date('2026-11-06T04:00:00.000Z');

/** Create a temp dir, run `fn`, always clean up. */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ce-core-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

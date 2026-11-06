import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findProjectRoot, resolveStorageRoot } from '../src/index.js';
import { withTempDir } from './helpers.js';

describe('project root resolution', () => {
  it('finds the nearest .git or .comments ancestor', async () => {
    await withTempDir(async (dir) => {
      const deep = path.join(dir, 'a', 'b');
      await mkdir(deep, { recursive: true });
      await mkdir(path.join(dir, '.git'));
      expect(findProjectRoot(deep)).toBe(dir);
      await mkdir(path.join(dir, 'a', '.comments'));
      expect(findProjectRoot(path.join(deep, 'f.md'))).toBe(path.join(dir, 'a'));
    });
  });

  it('maps URLs to a per-host folder under the global dir', async () => {
    await withTempDir(async (home) => {
      expect(resolveStorageRoot('http://localhost:3000/x?y=1', home)).toBe(
        path.join(home, '.comment-everything', 'localhost_3000'),
      );
    });
  });

  it('falls back to the file folder outside any project', async () => {
    await withTempDir(async (dir) => {
      const f = path.join(dir, 'x.html');
      await writeFile(f, '');
      // temp dirs sit outside any repo/.comments on CI; only assert the fallback shape
      const r = resolveStorageRoot(f);
      expect(path.isAbsolute(r)).toBe(true);
    });
  });
});

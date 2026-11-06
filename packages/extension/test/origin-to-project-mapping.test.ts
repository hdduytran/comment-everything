import { describe, expect, it } from 'vitest';
import { memoryStore } from '../src/key-value-store.js';
import {
  GLOBAL_FOLDER,
  clearMappedRoot,
  getMappedRoot,
  originOf,
  pageSource,
  setMappedRoot,
} from '../src/origin-to-project-mapping.js';

describe('origin-to-project mapping', () => {
  it('derives origins for http(s) pages only', () => {
    expect(originOf('http://localhost:3000/a/b?x=1#h')).toBe('http://localhost:3000');
    expect(originOf('https://example.com/')).toBe('https://example.com');
    expect(originOf('chrome://extensions')).toBeNull();
    expect(originOf('file:///tmp/a.html')).toBeNull();
    expect(originOf('not a url')).toBeNull();
  });

  it('uses the page url without its fragment as the comment source', () => {
    expect(pageSource('http://localhost:3000/a?x=1#section')).toBe('http://localhost:3000/a?x=1');
  });

  it('remembers one root per origin, port included', async () => {
    const store = memoryStore();
    await setMappedRoot(store, 'http://localhost:3000', '/work/app');
    await setMappedRoot(store, 'http://localhost:4000', '/work/other');
    expect(await getMappedRoot(store, 'http://localhost:3000')).toBe('/work/app');
    expect(await getMappedRoot(store, 'http://localhost:4000')).toBe('/work/other');
    expect(await getMappedRoot(store, 'http://localhost:5000')).toBeUndefined();
  });

  it('replaces an existing mapping and can opt out to the global folder', async () => {
    const store = memoryStore();
    await setMappedRoot(store, 'http://localhost:3000', '/work/app');
    await setMappedRoot(store, 'http://localhost:3000', GLOBAL_FOLDER);
    expect(await getMappedRoot(store, 'http://localhost:3000')).toBe(GLOBAL_FOLDER);
  });

  it('clears a mapping', async () => {
    const store = memoryStore();
    await setMappedRoot(store, 'http://localhost:3000', '/work/app');
    await clearMappedRoot(store, 'http://localhost:3000');
    expect(await getMappedRoot(store, 'http://localhost:3000')).toBeUndefined();
  });

  it('rejects non-origins and relative roots', async () => {
    const store = memoryStore();
    await expect(setMappedRoot(store, 'http://localhost:3000/path', '/work/app')).rejects.toThrow();
    await expect(setMappedRoot(store, 'localhost', '/work/app')).rejects.toThrow();
    await expect(setMappedRoot(store, 'http://localhost:3000', 'relative/dir')).rejects.toThrow();
  });
});

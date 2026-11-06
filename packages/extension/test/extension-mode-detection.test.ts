import { afterEach, describe, expect, it, vi } from 'vitest';
import { getModePreference, setModePreference } from '../src/extension-mode.js';
import { computeStatus } from '../src/extension-status.js';
import { memoryStore } from '../src/key-value-store.js';
import { createLocalTransport } from '../src/local-comment-store.js';
import { memoryAssetStore } from '../src/local-asset-store.js';
import { setMappedRoot } from '../src/origin-to-project-mapping.js';

const ORIGIN = 'http://localhost:3000';

/** A fake daemon answering /health and /roots like the real one. */
function stubDaemon(opts: { up: boolean; token?: string }) {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (!opts.up) throw new TypeError('fetch failed');
    const path = new URL(String(url)).pathname;
    if (path === '/health') return new Response('{"ok":true}');
    const token = new Headers(init?.headers).get('x-ce-token');
    if (token !== opts.token) return new Response('{}', { status: 401 });
    return Response.json({ roots: [{ id: 'r1', root: '/work/app' }] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

describe('mode preference', () => {
  it('defaults to auto and rejects unknown values', async () => {
    const store = memoryStore();
    expect(await getModePreference(store)).toBe('auto');
    await setModePreference(store, 'standalone');
    expect(await getModePreference(store)).toBe('standalone');
    await expect(setModePreference(store, 'cloud' as never)).rejects.toThrow(/Unknown mode/);
    await store.set('modePreference', 'garbage');
    expect(await getModePreference(store)).toBe('auto');
  });
});

describe('mode detection on toggle', () => {
  it('auto: an unreachable daemon means standalone', async () => {
    stubDaemon({ up: false });
    expect(await computeStatus(memoryStore(), ORIGIN)).toEqual({
      state: 'standalone',
      reason: 'daemon-down',
    });
  });

  it('auto: a reachable but unpaired daemon means standalone', async () => {
    stubDaemon({ up: true });
    expect(await computeStatus(memoryStore(), ORIGIN)).toEqual({
      state: 'standalone',
      reason: 'unpaired',
    });
  });

  it('auto: probes /health on the daemon port with a short timeout', async () => {
    const fetchMock = stubDaemon({ up: false });
    await computeStatus(memoryStore({ daemonPort: 4999 }), ORIGIN);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://127.0.0.1:4999/health');
    const signal = fetchMock.mock.calls[0]![1]!.signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('auto: a paired daemon keeps daemon behaviour (project choice, then ready)', async () => {
    stubDaemon({ up: true, token: 'tok' });
    const store = memoryStore({ pairing: { token: 'tok', port: 4317 } });
    expect(await computeStatus(store, ORIGIN)).toMatchObject({
      state: 'needs-root',
      origin: ORIGIN,
    });
    await setMappedRoot(store, ORIGIN, '/work/app');
    expect(await computeStatus(store, ORIGIN)).toEqual({
      state: 'ready',
      baseUrl: 'http://127.0.0.1:4317',
      root: '/work/app',
      migratable: 0,
    });
  });

  it('ready reports how many unresolved local comments could move to the project', async () => {
    stubDaemon({ up: true, token: 'tok' });
    const store = memoryStore({ pairing: { token: 'tok', port: 4317 } });
    await setMappedRoot(store, ORIGIN, '/work/app');
    const local = createLocalTransport({
      source: `${ORIGIN}/a`,
      store,
      assets: memoryAssetStore(),
    });
    await local.sendBatch([
      { source: `${ORIGIN}/a`, text: 'one' },
      { source: `${ORIGIN}/a`, text: 'two' },
    ]);
    expect(await computeStatus(store, ORIGIN)).toMatchObject({ state: 'ready', migratable: 2 });
  });

  it('standalone only: never contacts the daemon', async () => {
    const fetchMock = stubDaemon({ up: true, token: 'tok' });
    const store = memoryStore({
      modePreference: 'standalone',
      pairing: { token: 'tok', port: 4317 },
    });
    expect(await computeStatus(store, ORIGIN)).toEqual({ state: 'standalone', reason: 'forced' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('daemon only: keeps the setup cards instead of falling back', async () => {
    stubDaemon({ up: false });
    const store = memoryStore({ modePreference: 'daemon' });
    expect(await computeStatus(store, ORIGIN)).toMatchObject({ state: 'daemon-down' });
    stubDaemon({ up: true });
    expect(await computeStatus(store, ORIGIN)).toMatchObject({ state: 'unpaired' });
  });
});

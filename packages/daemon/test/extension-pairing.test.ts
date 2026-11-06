import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDaemon } from '../src/index.js';
import { createTestEnv, rawRequest, type TestEnv } from './helpers.js';

const EXT = 'b'.repeat(32);
let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.cleanup());

/** GET /pair and pull the one-time nonce out of the page. */
async function openPairPage(ext = EXT) {
  const res = await rawRequest(env.daemon.port, `/pair?ext=${ext}`);
  const nonce = /"nonce":"([0-9a-f]+)"/.exec(res.body)?.[1] ?? '';
  return { res, nonce };
}

const confirm = (nonce: string, headers: Record<string, string> = {}) =>
  rawRequest(
    env.daemon.port,
    '/pair/confirm',
    { 'content-type': 'application/json', ...headers },
    'POST',
    JSON.stringify({ nonce }),
  );

describe('extension pairing', () => {
  it('serves a confirmation page without a token, protected against framing', async () => {
    const { res, nonce } = await openPairPage();
    expect(res.status).toBe(200);
    expect(nonce).toHaveLength(48);
    expect(res.body).toContain(EXT);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['content-security-policy']).toContain(`'nonce-${nonce}'`);
    expect(res.body).not.toContain(env.daemon.token); // token only after the click
  });

  it('rejects ids that are not Chrome extension ids', async () => {
    expect((await rawRequest(env.daemon.port, '/pair?ext=<script>')).status).toBe(400);
    expect((await rawRequest(env.daemon.port, '/pair')).status).toBe(400);
  });

  it('confirm without the daemon Origin is refused (CSRF), and the nonce survives', async () => {
    const { nonce } = await openPairPage();
    expect((await confirm(nonce)).status).toBe(403);
    expect((await confirm(nonce, { origin: 'https://evil.example' })).status).toBe(403);
    expect(env.daemon.pairedExtensions.has(EXT)).toBe(false);
  });

  it('confirm with an unknown nonce is refused', async () => {
    const res = await confirm('0'.repeat(48), { origin: env.daemon.url });
    expect(res.status).toBe(403);
  });

  it('confirm pairs the extension once, returns the token, and pins the origin', async () => {
    const origin = `chrome-extension://${EXT}`;
    const before = await rawRequest(env.daemon.port, '/roots', {
      origin,
      'x-ce-token': env.daemon.token,
    });
    expect(before.status).toBe(403);

    const { nonce } = await openPairPage();
    const res = await confirm(nonce, { origin: env.daemon.url });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      ext: EXT,
      token: env.daemon.token,
      port: env.daemon.port,
    });
    expect((await confirm(nonce, { origin: env.daemon.url })).status).toBe(403); // one-time

    const after = await rawRequest(env.daemon.port, '/roots', {
      origin,
      'x-ce-token': env.daemon.token,
    });
    expect(after.status).toBe(200);
  });

  it('persists paired ids across daemon restarts', async () => {
    const file = path.join(env.home, '.comment-everything', 'paired-extensions.json');
    expect(JSON.parse(await readFile(file, 'utf8'))).toContain(EXT);
    const again = await startDaemon({ port: 0, home: env.home, watch: false, useLockfile: false });
    try {
      expect(again.pairedExtensions.has(EXT)).toBe(true);
    } finally {
      await again.stop();
    }
  });
});

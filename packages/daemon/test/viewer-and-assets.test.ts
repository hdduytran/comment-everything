import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { injectScriptTag } from '../src/index.js';
import { createTestEnv, rawRequest, type TestEnv } from './helpers.js';

let env: TestEnv;
let viewerDir: string;
beforeAll(async () => {
  viewerDir = await mkdtemp(path.join(tmpdir(), 'ce-viewer-'));
  await writeFile(path.join(viewerDir, 'viewer-main.js'), 'export {};');
  await writeFile(path.join(viewerDir, 'frame-agent.js'), '/* agent */');
  await mkdir(path.join(viewerDir, 'sub'));
  env = await createTestEnv({ viewerDir });
  await writeFile(
    path.join(env.project, 'page.html'),
    '<!doctype html><html><body><p>hi</p></body></html>',
  );
});
afterAll(async () => {
  await env.cleanup();
  await rm(viewerDir, { recursive: true, force: true });
});

const auth = () => ({ 'x-ce-token': env.daemon.token });
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('viewer shell and bundle', () => {
  it('allows only same-origin scripts in the viewer CSP', async () => {
    const res = await rawRequest(
      env.daemon.port,
      `/view?path=${encodeURIComponent(path.join(env.project, 'page.html'))}`,
    );
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.body).toContain('src="/_ce/viewer-main.js"');
  });

  it('serves bundle files without a token but never outside the bundle', async () => {
    const ok = await rawRequest(env.daemon.port, '/_ce/viewer-main.js');
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('javascript');
    for (const bad of ['/_ce/..%2fsecret.txt', '/_ce/.hidden', '/_ce/sub', '/_ce/missing.js']) {
      expect((await rawRequest(env.daemon.port, bad)).status, bad).toBe(404);
    }
  });
});

describe('frame agent injection', () => {
  const url = () => `/s/${env.daemon.token}/files/${env.rootId}/page.html`;

  it('splices the agent only when asked, keeping the sandbox CSP and no token in the tag', async () => {
    const plain = await rawRequest(env.daemon.port, url());
    expect(plain.body).not.toContain('frame-agent');

    const res = await rawRequest(env.daemon.port, `${url()}?ce-frame=1`);
    expect(res.status).toBe(200);
    expect(res.body).toContain(
      `<script src="http://127.0.0.1:${env.daemon.port}/_ce/frame-agent.js"></script></body>`,
    );
    expect(String(res.headers['content-security-policy'])).toContain('sandbox');
    expect(res.headers['content-length']).toBe(String(Buffer.byteLength(res.body)));
    const tag = /<script src="[^"]*frame-agent[^"]*">/.exec(res.body)?.[0] ?? '';
    expect(tag).not.toContain(env.daemon.token);
  });

  it('injectScriptTag handles missing body tags and uppercase', () => {
    expect(injectScriptTag(Buffer.from('<p>x'), '/a.js').toString()).toBe(
      '<p>x<script src="/a.js"></script>',
    );
    expect(injectScriptTag(Buffer.from('<P>x</BODY>'), '/a.js').toString()).toBe(
      '<P>x<script src="/a.js"></script></BODY>',
    );
  });
});

describe('POST /comments/assets', () => {
  const upload = (body: RequestInit['body'], q = `root=${encodeURIComponent(env.project)}`) =>
    env.api(`/comments/assets?${q}`, {
      method: 'POST',
      body,
      headers: { 'content-type': 'image/png' },
    });

  it('stores a png under .comments/assets and returns the relative path', async () => {
    const res = await upload(PNG);
    expect(res.status).toBe(201);
    const { asset } = (await res.json()) as { asset: string };
    expect(asset).toMatch(/^assets\/[\w-]+\.png$/);
    expect(await readdir(path.join(env.project, '.comments', 'assets'))).toContain(
      path.basename(asset),
    );
  });

  it('rejects non-images, empty and oversized bodies, and missing targets', async () => {
    expect((await upload('<svg onload=alert(1)>')).status).toBe(400);
    expect((await upload(new Uint8Array(0))).status).toBe(400);
    expect((await upload(Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]))).status).toBe(400);
    expect((await upload(PNG, '')).status).toBe(400);
  });

  it('requires the token and a trusted origin', async () => {
    const q = `root=${encodeURIComponent(env.project)}`;
    const noToken = await rawRequest(env.daemon.port, `/comments/assets?${q}`, {}, 'POST');
    expect(noToken.status).toBe(401);
    const evil = await rawRequest(
      env.daemon.port,
      `/comments/assets?${q}`,
      { ...auth(), origin: 'https://evil.example' },
      'POST',
    );
    expect(evil.status).toBe(403);
  });
});

describe('file.changed events', () => {
  it('publishes after a viewed file is edited', async () => {
    const file = path.join(env.project, 'watched.md');
    await writeFile(file, '# one\n');
    await rawRequest(env.daemon.port, `/view?path=${encodeURIComponent(file)}`);
    const ac = new AbortController();
    const res = await env.api('/events', { signal: ac.signal });
    const reader = res.body!.getReader();
    let text = '';
    const pump = (async () => {
      const dec = new TextDecoder();
      while (!text.includes('file.changed')) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value);
      }
    })();
    await new Promise((r) => setTimeout(r, 150));
    await writeFile(file, '# two\n');
    await Promise.race([pump, new Promise((r) => setTimeout(r, 3000))]);
    ac.abort();
    expect(text).toContain('event: file.changed');
    expect(text).toContain('"path":"watched.md"');
  });
});

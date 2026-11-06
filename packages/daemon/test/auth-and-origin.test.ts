import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, rawRequest, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.cleanup());

describe('token auth', () => {
  it('serves /health without a token', async () => {
    const res = await rawRequest(env.daemon.port, '/health');
    expect(res.status).toBe(200);
  });

  it('401 when the token is missing or wrong', async () => {
    expect((await rawRequest(env.daemon.port, '/comments')).status).toBe(401);
    expect((await rawRequest(env.daemon.port, '/comments', { 'x-ce-token': 'nope' })).status).toBe(
      401,
    );
    expect(
      (await rawRequest(env.daemon.port, '/roots', { authorization: 'Bearer nope' })).status,
    ).toBe(401);
    expect((await rawRequest(env.daemon.port, '/mcp', {}, 'POST')).status).toBe(401);
    expect((await rawRequest(env.daemon.port, '/events')).status).toBe(401);
  });

  it('accepts the token as header, bearer, or query on GET', async () => {
    const t = env.daemon.token;
    expect((await rawRequest(env.daemon.port, '/comments', { 'x-ce-token': t })).status).toBe(200);
    expect(
      (await rawRequest(env.daemon.port, '/comments', { authorization: `Bearer ${t}` })).status,
    ).toBe(200);
    expect((await rawRequest(env.daemon.port, `/comments?token=${t}`)).status).toBe(200);
  });
});

describe('origin and host checks', () => {
  const t = () => ({ 'x-ce-token': env.daemon.token });

  it('403 for a foreign Origin even with a valid token', async () => {
    const res = await rawRequest(env.daemon.port, '/comments', {
      ...t(),
      origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('checks Origin before the token (403, not 401)', async () => {
    const res = await rawRequest(env.daemon.port, '/comments', { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });

  it('403 for the opaque "null" origin outside /files', async () => {
    expect(
      (await rawRequest(env.daemon.port, '/comments', { ...t(), origin: 'null' })).status,
    ).toBe(403);
  });

  it('allows the daemon origin and chrome-extension:// origins', async () => {
    const same = await rawRequest(env.daemon.port, '/comments', { ...t(), origin: env.daemon.url });
    expect(same.status).toBe(200);
    const ext = await rawRequest(env.daemon.port, '/comments', {
      ...t(),
      origin: 'chrome-extension://abcdef',
    });
    expect(ext.status).toBe(200);
    expect(ext.headers['access-control-allow-origin']).toBe('chrome-extension://abcdef');
  });

  it('answers CORS preflight for the extension without a token, and refuses foreign origins', async () => {
    const ok = await rawRequest(
      env.daemon.port,
      '/comments',
      { origin: 'chrome-extension://abcdef', 'access-control-request-method': 'POST' },
      'OPTIONS',
    );
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-headers']).toContain('x-ce-token');
    const bad = await rawRequest(
      env.daemon.port,
      '/comments',
      { origin: 'https://evil.example' },
      'OPTIONS',
    );
    expect(bad.status).toBe(403);
  });

  it('403 when the Host header is not the loopback daemon (DNS rebinding)', async () => {
    const res = await rawRequest(env.daemon.port, '/health', { host: 'evil.example' });
    expect(res.status).toBe(403);
  });

  it('binds to 127.0.0.1 only', () => {
    expect(env.daemon.url).toBe(`http://127.0.0.1:${env.daemon.port}`);
  });
});

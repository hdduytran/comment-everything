import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ScopeError, resolveScopedPath } from '../src/index.js';
import { createTestEnv, rawRequest, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
  const outside = path.join(env.project, '..', 'secret.txt');
  await symlink(outside, path.join(env.project, 'leak.txt'));
  await symlink(path.join(env.project, 'index.html'), path.join(env.project, 'alias.html'));
  await mkdir(path.join(env.project, '.git'));
  await writeFile(path.join(env.project, '.git', 'config'), 'x');
  await writeFile(path.join(env.project, 'media.bin'), Buffer.from('0123456789'));
});
afterAll(() => env.cleanup());

const files = (rel: string) => `/files/${env.rootId}/${rel}`;
const auth = () => ({ 'x-ce-token': env.daemon.token });

describe('GET /files', () => {
  it('serves files inside the root', async () => {
    const res = await rawRequest(env.daemon.port, files('docs/guide.md'), auth());
    expect(res.status).toBe(200);
    expect(res.body).toBe('# Guide\n');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('requires the token', async () => {
    expect((await rawRequest(env.daemon.port, files('index.html'))).status).toBe(401);
  });

  it('supports the token-in-path form so relative URLs keep working', async () => {
    const res = await rawRequest(
      env.daemon.port,
      `/s/${env.daemon.token}/files/${env.rootId}/index.html`,
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(
      (await rawRequest(env.daemon.port, `/s/wrong/files/${env.rootId}/index.html`)).status,
    ).toBe(401);
  });

  it('403 for encoded ../ traversal', async () => {
    for (const rel of [
      '..%2fsecret.txt',
      '..%2F..%2Fetc%2Fpasswd',
      'docs%2f..%2f..%2fsecret.txt',
      '%2e%2e%5csecret.txt',
    ]) {
      const res = await rawRequest(env.daemon.port, files(rel), auth());
      expect(res.status, rel).toBe(403);
      expect(res.body).not.toContain('top secret');
    }
  });

  it('never leaks a file via un-normalized ../ in the raw path', async () => {
    const res = await rawRequest(env.daemon.port, files('../../secret.txt'), auth());
    expect(res.status).not.toBe(200);
    expect(res.body).not.toContain('top secret');
  });

  it('403 for a symlink that escapes the root, 200 for one that stays inside', async () => {
    const leak = await rawRequest(env.daemon.port, files('leak.txt'), auth());
    expect(leak.status).toBe(403);
    expect(leak.body).not.toContain('top secret');
    expect((await rawRequest(env.daemon.port, files('alias.html'), auth())).status).toBe(200);
  });

  it('refuses VCS folders, unknown roots and missing files', async () => {
    expect((await rawRequest(env.daemon.port, files('.git/config'), auth())).status).toBe(403);
    expect(
      (await rawRequest(env.daemon.port, '/files/unknownroot/index.html', auth())).status,
    ).toBe(404);
    expect((await rawRequest(env.daemon.port, files('nope.txt'), auth())).status).toBe(404);
  });

  it('honours Range requests for media seeking', async () => {
    const res = await rawRequest(env.daemon.port, files('media.bin'), {
      ...auth(),
      range: 'bytes=2-5',
    });
    expect(res.status).toBe(206);
    expect(res.body).toBe('2345');
    expect(res.headers['content-range']).toBe('bytes 2-5/10');
    expect(
      (await rawRequest(env.daemon.port, files('media.bin'), { ...auth(), range: 'bytes=50-' }))
        .status,
    ).toBe(416);
  });
});

describe('resolveScopedPath', () => {
  it('rejects NUL bytes, backslashes and bad encodings', async () => {
    await expect(resolveScopedPath(env.project, 'a%00b')).rejects.toMatchObject({ status: 400 });
    await expect(resolveScopedPath(env.project, '%E0%A4%A')).rejects.toBeInstanceOf(ScopeError);
    await expect(resolveScopedPath(env.project, 'a\\..\\b')).rejects.toMatchObject({ status: 403 });
  });
});

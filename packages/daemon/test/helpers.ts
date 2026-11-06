import http from 'node:http';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startDaemon, type MediaTools, type RunningDaemon } from '../src/index.js';

export interface TestEnv {
  home: string;
  project: string;
  daemon: RunningDaemon;
  rootId: string;
  /** fetch with the valid token header pre-applied. */
  api(pathAndQuery: string, init?: RequestInit): Promise<Response>;
  cleanup(): Promise<void>;
}

/** Start a daemon on a random port with an isolated home and a registered project folder. */
export async function createTestEnv(
  opts: { watch?: boolean; viewerDir?: string; mediaTools?: () => MediaTools } = {},
): Promise<TestEnv> {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'ce-daemon-')));
  const home = path.join(base, 'home');
  const project = path.join(base, 'project');
  await mkdir(home, { recursive: true });
  await mkdir(path.join(project, 'docs'), { recursive: true });
  await writeFile(path.join(project, 'index.html'), '<h1>Hello</h1>');
  await writeFile(path.join(project, 'docs', 'guide.md'), '# Guide\n');
  await writeFile(path.join(base, 'secret.txt'), 'top secret');

  const daemon = await startDaemon({
    port: 0,
    home,
    watch: opts.watch ?? false,
    viewerDir: opts.viewerDir,
    mediaTools: opts.mediaTools,
  });
  const reg = await daemon.registry.register(project);
  return {
    home,
    project,
    daemon,
    rootId: reg.id,
    api: (p, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set('x-ce-token', daemon.token);
      if (init.body && !headers.has('content-type'))
        headers.set('content-type', 'application/json');
      return fetch(daemon.url + p, { ...init, headers });
    },
    async cleanup() {
      await daemon.stop();
      await rm(base, { recursive: true, force: true });
    },
  };
}

export interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Raw HTTP request with full control over Host/Origin and an un-normalized path. */
export function rawRequest(
  port: number,
  reqPath: string,
  headers: Record<string, string> = {},
  method = 'GET',
  body?: string,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: reqPath,
        method,
        headers: { host: `127.0.0.1:${port}`, ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

export const sampleComment = (source = 'index.html', text = 'Fix this') => ({
  source,
  text,
  selectors: [{ type: 'CssSelector' as const, value: 'h1' }],
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only loosely typed JSON body
export const json = async (res: Response): Promise<any> => res.json();

/** Drop batches queued by earlier tests so wait_for_comments assertions start clean. */
export async function drainBatches(env: TestEnv): Promise<void> {
  while (await env.daemon.service.bus.nextBatch(5)) {
    /* discard */
  }
}

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

// Drives the built binary against an isolated home, so it needs `pnpm -r build` first.
describe.skipIf(!existsSync(CLI))('stop command and channel push (built binary)', () => {
  let base: string;
  let home: string;
  let project: string;
  const env = () => ({ ...process.env, COMMENT_EVERYTHING_HOME: home }) as Record<string, string>;
  const lockFile = () => path.join(home, '.comment-everything', 'daemon.json');
  const readLock = async () => JSON.parse(await readFile(lockFile(), 'utf8'));

  beforeAll(async () => {
    base = await realpath(await mkdtemp(path.join(tmpdir(), 'ce-stop-')));
    home = path.join(base, 'home');
    project = path.join(base, 'project');
    await mkdir(home, { recursive: true });
    await mkdir(path.join(project, '.comments'), { recursive: true });
  });

  afterAll(async () => {
    spawnSync('node', [CLI, 'stop'], { env: env() }); // never leak the detached daemon
    await rm(base, { recursive: true, force: true });
  });

  it('mcp --channel declares the capability and pushes a sent batch as a notification', async () => {
    const client = new Client({ name: 'channel-test', version: '0' });
    const pushed = new Promise<{ content: string; meta: Record<string, string> }>((resolve) => {
      client.fallbackNotificationHandler = async (n) => {
        if (n.method === 'notifications/claude/channel') {
          resolve(n.params as { content: string; meta: Record<string, string> });
        }
      };
    });
    await client.connect(
      new StdioClientTransport({
        command: 'node',
        args: [CLI, 'mcp', '--channel', '--port', '0'],
        env: env(),
        cwd: project,
      }),
    );
    expect(client.getServerCapabilities()?.experimental).toHaveProperty('claude/channel');

    const lock = await readLock();
    const res = await fetch(`http://127.0.0.1:${lock.port}/comments`, {
      method: 'POST',
      headers: { 'x-ce-token': lock.token, 'content-type': 'application/json' },
      body: JSON.stringify({
        root: project,
        batchId: 'batch-push',
        comments: [{ source: 'page.html', selectors: [], text: 'Pushed comment' }],
      }),
    });
    expect(res.status).toBe(201);

    const msg = await pushed;
    expect(msg.meta).toEqual({ batch_id: 'batch-push', count: '1' });
    expect(msg.content).toContain('Pushed comment');
    expect(msg.content).toContain('<untrusted_user_comment>');
    await client.close();
  });

  it('stop terminates the daemon recorded in the lockfile, then reports not running', async () => {
    const { pid } = await readLock();
    const stopped = spawnSync('node', [CLI, 'stop'], { encoding: 'utf8', env: env() });
    expect(stopped.status, stopped.stderr).toBe(0);
    expect(stopped.stdout).toContain(`Stopped comment-everything daemon (pid ${pid})`);
    expect(() => process.kill(pid, 0)).toThrow();

    const again = spawnSync('node', [CLI, 'stop'], { encoding: 'utf8', env: env() });
    expect(again.status).toBe(0);
    expect(again.stdout).toContain('not running');
  });
});

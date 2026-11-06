import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

// These tests drive the built binary, so they need `pnpm -r build` first (CI does this).
describe.skipIf(!existsSync(CLI))('comment-everything CLI (built binary)', () => {
  let base: string;
  let home: string;
  let project: string;
  const env = () => ({ ...process.env, COMMENT_EVERYTHING_HOME: home }) as Record<string, string>;

  beforeAll(async () => {
    base = await realpath(await mkdtemp(path.join(tmpdir(), 'ce-cli-')));
    home = path.join(base, 'home');
    project = path.join(base, 'project');
    await mkdir(home, { recursive: true });
    await mkdir(path.join(project, '.comments'), { recursive: true });
    await writeFile(path.join(project, 'page.html'), '<h1>Hi</h1>');
    await writeFile(
      path.join(project, '.comments', 'seed-1.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'seed-1',
        source: 'page.html',
        selectors: [],
        text: 'Seeded comment from disk',
        status: 'open',
        assets: [],
        createdAt: '2026-11-06T04:00:00.000Z',
        updatedAt: '2026-11-06T04:00:00.000Z',
        batchId: 'batch-seed',
      }),
    );
  });

  /** Stop any daemon this suite started (it is detached, so it would otherwise leak). */
  afterAll(async () => {
    try {
      const lock = JSON.parse(
        await readFile(path.join(home, '.comment-everything', 'daemon.json'), 'utf8'),
      );
      process.kill(lock.pid, 'SIGTERM');
    } catch {
      // no daemon was started
    }
    await new Promise((r) => setTimeout(r, 300));
    await rm(base, { recursive: true, force: true });
  });

  it('prints usage for --help and fails on unknown commands', () => {
    expect(spawnSync('node', [CLI, '--help'], { encoding: 'utf8' }).stdout).toContain(
      'comment-everything open <file>',
    );
    const bad = spawnSync('node', [CLI, 'bogus'], { encoding: 'utf8' });
    expect(bad.status).toBe(1);
  });

  it('open: starts the daemon, registers the root and prints a working viewer URL', async () => {
    const out = spawnSync(
      'node',
      [CLI, 'open', path.join(project, 'page.html'), '--no-open', '--port', '0'],
      {
        encoding: 'utf8',
        env: env(),
      },
    );
    expect(out.status, out.stderr).toBe(0);
    const url = out.stdout.trim();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/view\?path=/);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"source":"page.html"');

    const missing = spawnSync('node', [CLI, 'open', path.join(project, 'nope.html'), '--no-open'], {
      encoding: 'utf8',
      env: env(),
    });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('File not found');
  });

  it('mcp: stdio server proxies list_comments to the daemon for the cwd project', async () => {
    const client = new Client({ name: 'cli-test', version: '0' });
    await client.connect(
      new StdioClientTransport({
        command: 'node',
        args: [CLI, 'mcp', '--port', '0'],
        env: env(),
        cwd: project,
      }),
    );
    const res = (await client.callTool({ name: 'list_comments', arguments: {} })) as {
      content: { type: string; text: string }[];
    };
    const text = res.content.map((c) => c.text).join('\n');
    expect(text).toContain('Seeded comment from disk');
    expect(text).toContain('<untrusted_user_comment>');
    await client.close();
  });

  it('serve: a second serve reuses the running daemon instead of starting another', () => {
    const out = spawnSync('node', [CLI, 'serve', '--port', '0'], {
      encoding: 'utf8',
      env: env(),
      timeout: 15_000,
    });
    expect(out.status).toBe(0);
    expect(out.stderr).toContain('already running');
  });
});

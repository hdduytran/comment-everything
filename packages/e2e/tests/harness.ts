import { test as base, expect, type Page } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', '..', 'cli', 'dist', 'cli.js');
const FIXTURES = path.resolve(HERE, '..', 'fixtures');

interface DaemonHandle {
  home: string;
  url: string;
  token: string;
}

export interface StoredComment {
  id: string;
  source: string;
  text: string;
  status: string;
  selectors: Record<string, unknown>[];
  assets: string[];
}

export interface Project {
  dir: string;
  /** Viewer URL for a fixture file, as printed by `comment-everything open`. */
  open(file: string): string;
  comments(): Promise<StoredComment[]>;
  daemon: DaemonHandle;
}

async function waitFor<T>(fn: () => Promise<T | null>, what: string, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

export const test = base.extend<{ project: Project }, { daemon: DaemonHandle }>({
  // One real daemon per worker, started through the built CLI; always stopped afterwards.
  daemon: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const home = await realpath(await mkdtemp(path.join(tmpdir(), 'ce-e2e-home-')));
      const child: ChildProcess = spawn(process.execPath, [CLI, 'serve', '--port', '0'], {
        env: { ...process.env, COMMENT_EVERYTHING_HOME: home },
        stdio: 'ignore',
      });
      try {
        const lock = await waitFor(async () => {
          const raw = await readFile(path.join(home, '.comment-everything', 'daemon.json'), 'utf8');
          return JSON.parse(raw) as { port: number; token: string };
        }, 'daemon lockfile');
        await use({ home, url: `http://127.0.0.1:${lock.port}`, token: lock.token });
      } finally {
        child.kill('SIGTERM');
        await new Promise((r) => (child.exitCode !== null ? r(null) : child.once('exit', r)));
        await rm(home, { recursive: true, force: true });
      }
    },
    { scope: 'worker' },
  ],

  project: async ({ daemon }, use) => {
    const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'ce-e2e-project-')));
    await cp(FIXTURES, dir, { recursive: true });
    await mkdir(path.join(dir, '.comments'));
    await use({
      dir,
      daemon,
      open(file) {
        const res = spawnSync(process.execPath, [CLI, 'open', path.join(dir, file), '--no-open'], {
          env: { ...process.env, COMMENT_EVERYTHING_HOME: daemon.home },
          encoding: 'utf8',
        });
        const url = res.stdout.trim().split('\n').pop() ?? '';
        if (res.status !== 0 || !url.startsWith(daemon.url)) {
          throw new Error(`open failed: ${res.stderr || res.stdout}`);
        }
        return url;
      },
      async comments() {
        const base = path.join(dir, '.comments');
        const names = (await readdir(base)).filter((n) => n.endsWith('.json'));
        const all = await Promise.all(
          names.map(async (n) => JSON.parse(await readFile(path.join(base, n), 'utf8'))),
        );
        return (all as (StoredComment & { createdAt: string })[]).sort(
          (a, b) => a.createdAt.localeCompare(b.createdAt) || a.text.localeCompare(b.text),
        );
      },
    });
    await rm(dir, { recursive: true, force: true });
  },
});

export { expect };

/** Locators into the overlay (Playwright pierces open shadow roots). */
export const ui = (page: Page) => ({
  mode: (m: 'element' | 'text' | 'region') => page.locator(`[data-ce=mode-${m}]`),
  drafts: page.locator('[data-ce=draft]'),
  texts: page.locator('[data-ce=draft-text]'),
  send: page.locator('[data-ce=send]'),
  copy: page.locator('[data-ce=copy]'),
  toast: page.locator('[data-ce=toast]'),
  sent: page.locator('[data-ce=sent-item]'),
});

/** Fill every pending draft's textarea in order, then press Send and wait for the daemon. */
export async function writeAndSend(page: Page, texts: string[]): Promise<void> {
  const o = ui(page);
  for (const [i, t] of texts.entries()) await o.texts.nth(i).fill(t);
  await o.send.click();
  await expect(o.toast).toContainText(`Sent ${texts.length}`);
}

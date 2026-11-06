import { chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_BUILD = path.resolve(HERE, '..', '..', 'extension', 'dist');
const FIXTURES = path.resolve(HERE, '..', 'fixtures');

export interface Harness {
  context: BrowserContext;
  worker: Worker;
  pageUrl: string;
  cleanup(): Promise<void>;
}

/**
 * Load a copy of the built extension. The copy's manifest gains host permissions (the test
 * daemon port, and <all_urls> for captureVisibleTab): tests cannot press the toolbar button, so `activeTab` is
 * never granted, and the daemon runs on a random port instead of 4317.
 */
export async function launchWithExtension(
  daemonUrl: string,
  fixture = 'page.html',
): Promise<Harness> {
  const work = await realpath(await mkdtemp(path.join(tmpdir(), 'ce-e2e-ext-')));
  const extDir = path.join(work, 'extension');
  await cp(EXTENSION_BUILD, extDir, { recursive: true });
  const manifestPath = path.join(extDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [`${daemonUrl}/*`, '<all_urls>'];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const html = await readFile(path.join(FIXTURES, fixture));
  const web = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(html);
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
  const pageUrl = `http://localhost:${(web.address() as AddressInfo).port}/app/index.html`;

  const context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
    channel: 'chromium', // new headless mode, which supports extensions
    headless: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return {
    context,
    worker,
    pageUrl,
    async cleanup() {
      await context.close();
      await new Promise((r) => web.close(r));
      await rm(work, { recursive: true, force: true });
    },
  };
}

/** What the toolbar button does: fire the action click for the tab showing `pageUrl`. */
export async function clickToolbar(worker: Worker, pageUrl: string): Promise<void> {
  await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    (chrome.action.onClicked as unknown as { dispatch(t: unknown): void }).dispatch(tab);
  }, pageUrl);
}

export const setup = (page: Page, ce: string) => page.locator(`[data-ce-setup] [data-ce=${ce}]`);

/** Pair the extension with the daemon and map the page's origin to `project` (toolbar click first). */
export async function pairAndMapProject(
  h: Harness,
  daemon: { url: string; token: string },
  page: Page,
  project: string,
): Promise<void> {
  const reg = await fetch(`${daemon.url}/roots`, {
    method: 'POST',
    headers: { 'x-ce-token': daemon.token, 'content-type': 'application/json' },
    body: JSON.stringify({ root: project }),
  });
  if (reg.status !== 201) throw new Error(`could not register project: ${reg.status}`);
  const port = Number(new URL(daemon.url).port);
  await h.worker.evaluate((p) => chrome.storage.local.set({ daemonPort: p }), port);
  await page.goto(h.pageUrl);
  await clickToolbar(h.worker, h.pageUrl);
  const popup = h.context.waitForEvent('page');
  await setup(page, 'pair').click();
  const pairPage = await popup;
  await pairPage.getByRole('button', { name: 'Pair this extension' }).click();
  await expect(pairPage.locator('#status')).toHaveText(/Paired/);
  await page.locator('[data-ce=root-select]').selectOption(project);
  await setup(page, 'save-root').click();
}

import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, ui, writeAndSend } from './harness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_BUILD = path.resolve(HERE, '..', '..', 'extension', 'dist');
const FIXTURE_PAGE = path.resolve(HERE, '..', 'fixtures', 'page.html');

interface Harness {
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
async function launchWithExtension(daemonUrl: string): Promise<Harness> {
  const work = await realpath(await mkdtemp(path.join(tmpdir(), 'ce-e2e-ext-')));
  const extDir = path.join(work, 'extension');
  await cp(EXTENSION_BUILD, extDir, { recursive: true });
  const manifestPath = path.join(extDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [`${daemonUrl}/*`, '<all_urls>'];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const html = await readFile(FIXTURE_PAGE);
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
async function clickToolbar(worker: Worker, pageUrl: string): Promise<void> {
  await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    (chrome.action.onClicked as unknown as { dispatch(t: unknown): void }).dispatch(tab);
  }, pageUrl);
}

const setup = (page: Page, ce: string) => page.locator(`[data-ce-setup] [data-ce=${ce}]`);

test.describe('Chrome extension', () => {
  test('shows the start hint when the daemon is not running', async ({ daemon }) => {
    const h = await launchWithExtension(daemon.url);
    try {
      await h.worker.evaluate(() => chrome.storage.local.set({ daemonPort: 1 }));
      const page = await h.context.newPage();
      await page.goto(h.pageUrl);
      await clickToolbar(h.worker, h.pageUrl);
      await expect(page.locator('[data-ce-setup=daemon-down]')).toContainText(
        'npx comment-everything serve',
      );
    } finally {
      await h.cleanup();
    }
  });

  test('pairs, maps the origin to a project, and saves a comment there', async ({ daemon }) => {
    const project = await realpath(await mkdtemp(path.join(tmpdir(), 'ce-e2e-extproject-')));
    await mkdir(path.join(project, '.comments'));
    const reg = await fetch(`${daemon.url}/roots`, {
      method: 'POST',
      headers: { 'x-ce-token': daemon.token, 'content-type': 'application/json' },
      body: JSON.stringify({ root: project }),
    });
    expect(reg.status).toBe(201);

    const h = await launchWithExtension(daemon.url);
    try {
      const port = Number(new URL(daemon.url).port);
      await h.worker.evaluate((p) => chrome.storage.local.set({ daemonPort: p }), port);
      const page = await h.context.newPage();
      await page.goto(h.pageUrl);

      // 1. Unpaired: the card offers pairing, which opens the daemon's confirmation page.
      await clickToolbar(h.worker, h.pageUrl);
      const popup = h.context.waitForEvent('page');
      await setup(page, 'pair').click();
      const pairPage = await popup;
      await pairPage.getByRole('button', { name: 'Pair this extension' }).click();
      await expect(pairPage.locator('#status')).toHaveText(/Paired/);

      // 2. Paired: choose the project that serves this origin.
      await expect(setup(page, 'save-root')).toBeVisible();
      await page.locator('[data-ce=root-select]').selectOption(project);
      await setup(page, 'save-root').click();

      // 3. Comment on an element and Send.
      const o = ui(page);
      await o.mode('element').click();
      await page.locator('#title').click();
      await expect(o.drafts).toHaveCount(1);
      await writeAndSend(page, ['Make the title larger']);

      const files = (await readdir(path.join(project, '.comments'))).filter((n) =>
        n.endsWith('.json'),
      );
      expect(files).toHaveLength(1);
      const comment = JSON.parse(
        await readFile(path.join(project, '.comments', files[0]!), 'utf8'),
      );
      expect(comment).toMatchObject({
        source: h.pageUrl,
        text: 'Make the title larger',
        status: 'open',
      });
      expect(comment.selectors).toContainEqual({ type: 'CssSelector', value: '#title' });

      // 4. Region screenshot via captureVisibleTab is uploaded as an asset.
      await o.mode('region').click();
      await page.mouse.move(40, 40);
      await page.mouse.down();
      await page.mouse.move(220, 140, { steps: 4 });
      await page.mouse.up();
      await expect(o.drafts).toHaveCount(1);
      await writeAndSend(page, ['Check this area']);
      const assets = await readdir(path.join(project, '.comments', 'assets'));
      expect(assets.some((n) => n.endsWith('.png'))).toBe(true);

      // 5. The mapping is remembered: toggling off and on starts the overlay directly.
      await clickToolbar(h.worker, h.pageUrl);
      await expect(o.send).toHaveCount(0);
      await clickToolbar(h.worker, h.pageUrl);
      await expect(o.send).toBeVisible();
    } finally {
      await h.cleanup();
      await rm(project, { recursive: true, force: true });
    }
  });
});

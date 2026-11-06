import { chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
  /** Where the browser saves downloads (a temp folder, never the real Downloads). */
  downloadsDir: string;
  /** Extension id, for chrome-extension:// pages. */
  extensionId: string;
  cleanup(): Promise<void>;
}

export interface LaunchOptions {
  /** Mode preference stored before the test starts. Default: `daemon` when a daemon URL is given, else `auto`. */
  mode?: 'auto' | 'standalone' | 'daemon';
}

/**
 * Load a copy of the built extension. The copy's manifest gains host permissions (any local
 * daemon port, and <all_urls> for captureVisibleTab): tests cannot press the toolbar button, so
 * `activeTab` is never granted, and daemons run on random ports instead of 4317.
 *
 * With `daemonUrl === null` no daemon is running; the extension is pointed at a closed port so the
 * developer's own daemon on 4317 can never leak into a test.
 */
export async function launchWithExtension(
  daemonUrl: string | null,
  fixture = 'page.html',
  options: LaunchOptions = {},
): Promise<Harness> {
  const work = await realpath(await mkdtemp(path.join(tmpdir(), 'ce-e2e-ext-')));
  const extDir = path.join(work, 'extension');
  await cp(EXTENSION_BUILD, extDir, { recursive: true });
  const manifestPath = path.join(extDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*', '<all_urls>'];
  delete manifest.optional_host_permissions; // already granted above
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const html = await readFile(path.join(FIXTURES, fixture));
  const web = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(html);
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
  const pageUrl = `http://localhost:${(web.address() as AddressInfo).port}/app/index.html`;

  const downloadsDir = path.join(work, 'Downloads'); // capital D: the toast shows ~/Downloads/...
  await mkdir(downloadsDir);
  const profile = path.join(work, 'profile');
  // Chrome's own download directory preference: files keep the names chrome.downloads gives them.
  await mkdir(path.join(profile, 'Default'), { recursive: true });
  await writeFile(
    path.join(profile, 'Default', 'Preferences'),
    JSON.stringify({
      download: { default_directory: downloadsDir, prompt_for_download: false },
      savefile: { default_directory: downloadsDir },
    }),
  );

  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', // new headless mode, which supports extensions
    headless: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  // Playwright renames every download to a GUID in its own folder; hand control back to Chrome so
  // chrome.downloads saves `comment-everything/<host>/<stamp>/...` under the profile's folder.
  const browserSession = await context.browser()!.newBrowserCDPSession();
  await browserSession.send('Browser.setDownloadBehavior', { behavior: 'default' });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const mode = options.mode ?? (daemonUrl ? 'daemon' : 'auto');
  const port = daemonUrl ? Number(new URL(daemonUrl).port) : 1;
  await worker.evaluate((prefs) => chrome.storage.local.set(prefs), {
    modePreference: mode,
    daemonPort: port,
  });
  return {
    context,
    worker,
    pageUrl,
    downloadsDir,
    extensionId: new URL(worker.url()).host,
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

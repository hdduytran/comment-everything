import { readdir, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clickToolbar, launchWithExtension, setup } from './extension-harness.js';
import { expect, test, ui, writeAndSend } from './harness.js';

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

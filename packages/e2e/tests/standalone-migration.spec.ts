import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clickToolbar, launchWithExtension, setup } from './extension-harness.js';
import { expect, startDaemon, test, ui } from './harness.js';

test.describe('From extension only to daemon mode', () => {
  test('a daemon appears: pair, then move the local comments into the project', async () => {
    const project = await realpath(await mkdtemp(path.join(tmpdir(), 'ce-e2e-migrate-')));
    await mkdir(path.join(project, '.comments'));
    const h = await launchWithExtension(null);
    let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
    try {
      const page = await h.context.newPage();
      const o = ui(page);
      const toast = page.locator('[data-ce=toast] .toast-text');

      // 1. No daemon: two comments (one with a screenshot) are saved in the browser.
      await page.goto(h.pageUrl);
      await clickToolbar(h.worker, h.pageUrl);
      await o.mode('element').click();
      await page.locator('#title').click();
      await o.mode('region').click();
      await page.mouse.move(40, 40);
      await page.mouse.down();
      await page.mouse.move(220, 140, { steps: 4 });
      await page.mouse.up();
      await expect(o.drafts).toHaveCount(2);
      await o.texts.nth(0).fill('Make the title larger');
      await o.texts.nth(1).fill('Check this area');
      await o.send.click(); // Export: saves locally (and downloads files)
      await expect(toast).toContainText('Exported 2 comments');
      expect(await localKeys(h)).toHaveLength(1);

      // 2. A daemon starts. Auto mode sees it but this browser is not paired: still standalone, with an offer.
      daemon = await startDaemon();
      const reg = await fetch(`${daemon.url}/roots`, {
        method: 'POST',
        headers: { 'x-ce-token': daemon.token, 'content-type': 'application/json' },
        body: JSON.stringify({ root: project }),
      });
      expect(reg.status).toBe(201);
      await h.worker.evaluate(
        (p) => chrome.storage.local.set({ daemonPort: p }),
        Number(new URL(daemon.url).port),
      );
      await page.reload();
      await clickToolbar(h.worker, h.pageUrl);
      await expect(page.locator('[data-ce=agent-status]')).toHaveText('Extension only');
      await expect(page.locator('[data-ce=offer]')).toContainText('A daemon is running');

      // 3. Pair from the offer; the panel continues on its own into project choice.
      const popup = h.context.waitForEvent('page');
      await page.locator('[data-ce=offer-run]').click();
      const pairPage = await popup;
      await pairPage.getByRole('button', { name: 'Pair this extension' }).click();
      await expect(pairPage.locator('#status')).toHaveText(/Paired/);
      await page.locator('[data-ce=root-select]').selectOption(project);
      await setup(page, 'save-root').click();

      // 4. Daemon mode (Send, not Export) with the migration offer for the two local comments.
      await expect(o.send).toContainText('Send');
      await expect(page.locator('[data-ce=agent-status] .agent-label')).not.toHaveText(
        'Extension only',
      );
      await expect(page.locator('[data-ce=offer]')).toContainText(
        '2 comments saved in this browser',
      );
      await page.locator('[data-ce=offer-run]').click();
      await expect(toast).toHaveText('Moved 2 comments to the project.');

      // 5. The project holds them as plain JSON with the screenshot uploaded; nothing stays local.
      const files = (await readdir(path.join(project, '.comments'))).filter((n) =>
        n.endsWith('.json'),
      );
      const comments = await Promise.all(
        files.map(async (n) =>
          JSON.parse(await readFile(path.join(project, '.comments', n), 'utf8')),
        ),
      );
      expect(comments.map((c) => c.text).sort()).toEqual([
        'Check this area',
        'Make the title larger',
      ]);
      expect(comments.every((c) => c.source === h.pageUrl && c.status === 'open')).toBe(true);
      const shot = comments.find((c) => c.text === 'Check this area');
      expect(shot.assets).toHaveLength(1);
      expect(shot.selectors).toContainEqual(
        expect.objectContaining({ type: 'ScreenshotSelector', asset: shot.assets[0] }),
      );
      const assets = await readdir(path.join(project, '.comments', 'assets'));
      expect(assets).toContain(path.basename(shot.assets[0]));
      expect(await localKeys(h)).toHaveLength(0);
      await expect(page.locator('[data-ce=offer]')).toBeHidden();
    } finally {
      await h.cleanup();
      await daemon?.stop();
      await rm(project, { recursive: true, force: true });
    }
  });
});

/** Storage keys holding comments saved in the browser. */
const localKeys = (h: Awaited<ReturnType<typeof launchWithExtension>>) =>
  h.worker.evaluate(async () =>
    Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('localComments:')),
  );

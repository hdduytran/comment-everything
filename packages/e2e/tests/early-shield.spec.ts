import type { Page } from '@playwright/test';
import { clickToolbar, launchWithExtension } from './extension-harness.js';
import { expect, test, ui } from './harness.js';

const fired = (page: Page) =>
  page.evaluate(() => (window as never as { __fired: string[] }).__fired);

/** Pick the title, then type into the new comment's box. */
async function typeInCommentBox(page: Page, text: string): Promise<void> {
  const o = ui(page);
  await o.mode('element').click();
  await page.locator('#title').click();
  await expect(o.drafts).toHaveCount(1);
  await o.texts.first().click();
  await page.keyboard.type(text);
  await expect(o.texts.first()).toHaveValue(text);
}

test.describe('Early keyboard shield', () => {
  test('a window capture listener registered before the panel opens misses keystrokes typed in it', async () => {
    const h = await launchWithExtension(null, 'early-capture-listener.html');
    try {
      const page = await h.context.newPage();
      await page.goto(h.pageUrl);

      // Without the shield the gap exists: the page's early capture listener sees the typing.
      await clickToolbar(h.worker, h.pageUrl);
      await typeInCommentBox(page, 'sg/');
      expect((await fired(page)).filter((e) => e.startsWith('keydown'))).toEqual([
        'keydown:s',
        'keydown:g',
        'keydown:/',
      ]);

      // Opt in (the harness already grants all-sites access). The origin was remembered when the
      // panel opened, so the script is registered for it.
      await h.worker.evaluate(() => chrome.storage.local.set({ earlyShield: true }));
      await expect
        .poll(() =>
          h.worker.evaluate(async () =>
            (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.matches),
          ),
        )
        .toEqual([[`${new URL(h.pageUrl).origin}/*`]]);

      // Reload: the shield now runs before the page's own scripts.
      await page.reload();
      await clickToolbar(h.worker, h.pageUrl);
      await page.evaluate(() => ((window as never as { __fired: string[] }).__fired.length = 0));
      await typeInCommentBox(page, 'sg/ việt');
      await page.keyboard.press('Control+A');
      expect(await fired(page)).toEqual([]);

      // Overlay handlers still work under the shield: Ctrl+Enter exports the comment.
      await page.keyboard.press('Control+Enter');
      await expect(page.locator('[data-ce=toast] .toast-text')).toContainText('Exported 1 comment');
      expect(await fired(page)).toEqual([]);

      // Keys typed on the page itself are untouched (panel closed, so picking is off).
      await clickToolbar(h.worker, h.pageUrl);
      await page.locator('#intro').click();
      await page.keyboard.press('x');
      expect(await fired(page)).toContain('keydown:x');
    } finally {
      await h.cleanup();
    }
  });
});

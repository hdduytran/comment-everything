import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchWithExtension, pairAndMapProject } from './extension-harness.js';
import { expect, test, ui } from './harness.js';

test.describe('Host page shortcuts', () => {
  test('typing in the comment box never reaches the page, and Esc / Ctrl+Enter still work', async ({
    daemon,
  }) => {
    const project = await realpath(await mkdtemp(path.join(tmpdir(), 'ce-e2e-shortcuts-')));
    await mkdir(path.join(project, '.comments'));
    const h = await launchWithExtension(daemon.url, 'github-style-shortcuts.html');
    try {
      const page = await h.context.newPage();
      await pairAndMapProject(h, daemon, page, project);
      const o = ui(page);
      const fired = () => page.evaluate(() => (window as never as { __fired: string[] }).__fired);
      const hashBefore = await page.evaluate(() => location.hash);

      // Sanity: the fixture really does react to shortcuts when focus is on the page.
      await page.locator('#intro').click();
      await page.keyboard.press('s');
      expect(await fired()).toContain('s');
      await page.locator('#intro').click();
      await page.evaluate(() => ((window as never as { __fired: string[] }).__fired.length = 0));

      await o.mode('element').click();
      await page.locator('#title').click();
      await expect(o.drafts).toHaveCount(1);
      const text = 'Press s or / to search, then g i for issues';
      await o.texts.first().click();
      await page.keyboard.type(text);
      await expect(o.texts.first()).toHaveValue(text);

      // Vietnamese-style IME composition: the page must not see it and the text must arrive intact.
      const cdp = await h.context.newCDPSession(page);
      await cdp.send('Input.imeSetComposition', {
        text: 'vie',
        selectionStart: 3,
        selectionEnd: 3,
      });
      await cdp.send('Input.insertText', { text: ' việt' });
      await expect(o.texts.first()).toHaveValue(`${text} việt`);

      expect(await fired()).toEqual([]);
      expect(await page.evaluate(() => location.hash)).toBe(hashBefore);
      expect(await page.evaluate(() => document.activeElement?.id)).not.toBe('search');

      // Ctrl+Enter sends the comment from inside the box.
      await page.keyboard.press('Control+Enter');
      await expect(o.toast).toContainText(/^(Sent|Saved)/);
      const files = (await readdir(path.join(project, '.comments'))).filter((n) =>
        n.endsWith('.json'),
      );
      expect(files).toHaveLength(1);
      const saved = JSON.parse(await readFile(path.join(project, '.comments', files[0]!), 'utf8'));
      expect(saved.text).toContain('Press s or / to search');
      expect(await fired()).toEqual([]);

      // Esc stops element picking even while focus is inside the panel.
      await expect(o.mode('element')).toHaveAttribute('aria-pressed', 'true'); // still picking
      await o.mode('element').focus();
      await page.keyboard.press('Escape');
      await expect(o.mode('element')).toHaveAttribute('aria-pressed', 'false');
      expect(await fired()).toEqual([]);

      // Picking does not leak the click to the page (the page's own handler would set the hash).
      await o.mode('element').click();
      await page.evaluate(() => {
        for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
          document.addEventListener(t, () => (window.name += `${t} `));
        }
      });
      await page.locator('#intro').click();
      expect(await page.evaluate(() => window.name)).toBe('');
    } finally {
      await h.cleanup();
      await rm(project, { recursive: true, force: true });
    }
  });
});

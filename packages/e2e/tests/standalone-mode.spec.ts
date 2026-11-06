import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { clickToolbar, launchWithExtension, type Harness } from './extension-harness.js';
import { expect, test, ui } from './harness.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function drawRegion(page: Page): Promise<void> {
  await ui(page).mode('region').click();
  await page.mouse.move(40, 40);
  await page.mouse.down();
  await page.mouse.move(220, 140, { steps: 4 });
  await page.mouse.up();
}

/** What a paste would receive: every clipboard flavour as text. */
const clipboard = (page: Page) =>
  page.evaluate(async () => {
    const out: Record<string, string> = {};
    for (const item of await navigator.clipboard.read()) {
      for (const type of item.types) out[type] = await (await item.getType(type)).text();
    }
    return out;
  });

async function openOverlay(h: Harness, page: Page): Promise<void> {
  await page.goto(h.pageUrl);
  await clickToolbar(h.worker, h.pageUrl);
  await expect(ui(page).send).toBeVisible();
}

test.describe('Extension only mode (no daemon running)', () => {
  test('comments, copies a prompt with images, exports files, and keeps them across reloads', async () => {
    const h = await launchWithExtension(null);
    try {
      const origin = new URL(h.pageUrl).origin;
      await h.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      await h.context.route('https://claude.ai/**', (r) => r.fulfill({ body: 'stub' }));
      const page = await h.context.newPage();
      await openOverlay(h, page);
      const o = ui(page);
      const toast = page.locator('[data-ce=toast] .toast-text');

      // The pill names the mode; Send became Export, with Open in Claude next to Copy prompt.
      const pill = page.locator('[data-ce=agent-status]');
      await expect(pill).toHaveText('Extension only');
      await pill.hover();
      await expect(page.locator('[role=tooltip]:visible')).toHaveText(
        'Extension only — comments stay in this browser',
      );
      await expect(o.send).toContainText('Export');
      await expect(page.locator('[data-ce=delivery-open-claude]')).toBeVisible();

      // One element comment and one region (screenshot) comment.
      await o.mode('element').click();
      await page.locator('#title').click();
      await drawRegion(page);
      await expect(o.drafts).toHaveCount(2);
      await o.texts.nth(0).fill('Make the title larger');
      await o.texts.nth(1).fill('Check this area');

      // Copy prompt: rich item (HTML with the screenshot inline) plus plain Markdown.
      await o.copy.click();
      await expect(toast).toContainText('Prompt copied');
      const copied = await clipboard(page);
      expect(copied['text/plain']).toContain('# Review comments (2)');
      expect(copied['text/plain']).toContain('> Make the title larger');
      expect(copied['text/html']).toContain('<img src="data:image/png;base64,');

      // Open in Claude: nothing in the address, prompt already on the clipboard.
      const opened = h.context.waitForEvent('page');
      await page.locator('[data-ce=delivery-open-claude]').click();
      const claude = await opened;
      await expect.poll(() => claude.url()).toBe('https://claude.ai/new');
      await expect(toast).toHaveText('Prompt copied — paste in Claude');
      await claude.close();
      await page.bringToFront();

      // Export writes the folder layout into Downloads.
      await o.send.click();
      await expect(o.toast).toContainText(
        'Exported 2 comments. Ask Claude Code: read ~/Downloads/',
      );
      const host = `localhost_${new URL(h.pageUrl).port}`;
      const hostDir = path.join(h.downloadsDir, 'comment-everything', host);
      const [stamp] = await readdir(hostDir);
      expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}$/);
      const dir = path.join(hostDir, stamp!);
      const files = (await readdir(dir, { recursive: true })).map(String).sort();
      expect(files).toContain('comments.md');
      expect(files).toContain('comments.json');
      const shots = files.filter((f) => /^assets[\\/].+\.png$/.test(f));
      expect(shots).toHaveLength(1);

      const md = await readFile(path.join(dir, 'comments.md'), 'utf8');
      expect(md).toContain('# Review comments (2)');
      expect(md).toContain(`\`${shots[0]!.replace(/\\/g, '/')}\``); // relative to comments.md
      expect(md).toContain('> Make the title larger');
      const json = JSON.parse(await readFile(path.join(dir, 'comments.json'), 'utf8'));
      expect(json.comments.map((c: { text: string }) => c.text)).toEqual([
        'Make the title larger',
        'Check this area',
      ]);
      expect(json.comments[0]).toMatchObject({
        schemaVersion: 1,
        source: h.pageUrl,
        status: 'open',
      });
      expect((await readFile(path.join(dir, shots[0]!))).subarray(0, 4)).toEqual(PNG_MAGIC);

      // The toast sentence is copyable and names the exact file.
      const sentence = `read ~/Downloads/comment-everything/${host}/${stamp}/comments.md and apply`;
      await expect(toast).toContainText(`Ask Claude Code: ${sentence}`);
      await page.locator('[data-ce=toast-copy]').click();
      expect((await clipboard(page))['text/plain']).toBe(sentence);

      // Saved comments live in this browser: mark one resolved, reload, still there.
      await expect(o.sent).toHaveCount(2);
      await o.sent.filter({ hasText: 'Check this area' }).locator('[data-ce=sent-resolve]').click();
      await expect(o.sent.filter({ hasText: 'Check this area' })).toHaveAttribute(
        'data-status',
        'resolved',
      );
      await page.reload();
      await clickToolbar(h.worker, h.pageUrl);
      await expect(o.sent).toHaveCount(2);
      await expect(o.sent.filter({ hasText: 'Check this area' })).toHaveAttribute(
        'data-status',
        'resolved',
      );
      await expect(o.sent.filter({ hasText: 'Make the title larger' })).toHaveAttribute(
        'data-status',
        'open',
      );
    } finally {
      await h.cleanup();
    }
  });

  test('the Extension only help tab explains the three options and the upgrade', async () => {
    const h = await launchWithExtension(null);
    try {
      const page = await h.context.newPage();
      await openOverlay(h, page);
      await page.locator('[data-ce=help-open]').click();
      const help = page.locator('[data-ce=help]');
      await expect(page.locator('[role=tab]').first()).toHaveText('Extension only');
      await expect(help).toContainText('Copy prompt');
      await expect(help).toContainText('Export');
      await expect(help).toContainText('Open in Claude');
      await expect(help).toContainText('comment-everything serve');
    } finally {
      await h.cleanup();
    }
  });

  test('the options page switches modes: Daemon shows setup steps, Standalone only skips the daemon', async ({
    daemon,
  }) => {
    const h = await launchWithExtension(null);
    try {
      const options = await h.context.newPage();
      await options.goto(`chrome-extension://${h.extensionId}/options-page.html`);
      const storedMode = () =>
        h.worker.evaluate(
          async () => (await chrome.storage.local.get('modePreference')).modePreference,
        );
      await expect(options.locator('input[data-mode=auto]')).toBeChecked();

      await options.locator('input[data-mode=daemon]').check();
      await expect.poll(storedMode).toBe('daemon');
      const page = await h.context.newPage();
      await page.goto(h.pageUrl);
      await clickToolbar(h.worker, h.pageUrl);
      await expect(page.locator('[data-ce-setup=daemon-down]')).toContainText(
        'npx comment-everything serve',
      );
      await clickToolbar(h.worker, h.pageUrl); // close the card

      // A daemon that is up must not matter once the user forces standalone.
      await h.worker.evaluate(
        (p) => chrome.storage.local.set({ daemonPort: p }),
        Number(new URL(daemon.url).port),
      );
      await options.locator('input[data-mode=standalone]').check();
      await expect.poll(storedMode).toBe('standalone');
      await clickToolbar(h.worker, h.pageUrl);
      await expect(page.locator('[data-ce=agent-status]')).toHaveText('Extension only');
    } finally {
      await h.cleanup();
    }
  });
});

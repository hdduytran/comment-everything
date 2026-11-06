import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { clickToolbar, launchWithExtension } from './extension-harness.js';
import { expect, test, ui } from './harness.js';

/**
 * Not a regression test: `CE_SHOTS_DIR=plans/reports/ui-261106 pnpm e2e standalone-screenshots`
 * saves light and dark screenshots of the extension-only panel for design review.
 */
const outDir = process.env.CE_SHOTS_DIR;
test.skip(!outDir, 'set CE_SHOTS_DIR to capture screenshots');

for (const scheme of ['light', 'dark'] as const) {
  test(`extension-only panel, ${scheme}`, async () => {
    const h = await launchWithExtension(null);
    try {
      const dir = path.resolve(process.cwd(), '..', '..', outDir!);
      await mkdir(dir, { recursive: true });
      const page = await h.context.newPage();
      await page.setViewportSize({ width: 960, height: 640 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(h.pageUrl);
      await clickToolbar(h.worker, h.pageUrl);
      const o = ui(page);
      const shot = (name: string) =>
        page.screenshot({ path: path.join(dir, `standalone-${name}-${scheme}.png`) });

      // 1. Empty panel: mode pill with its tooltip.
      await page.locator('[data-ce=agent-status]').hover();
      await expect(page.locator('[role=tooltip]:visible')).toContainText(
        'comments stay in this browser',
      );
      await shot('01-pill-tooltip');

      // 2. Two pending comments: Export is primary, Copy prompt and Open in Claude beside it.
      await o.mode('element').click();
      await page.locator('#title').click();
      await o.mode('region').click();
      await page.mouse.move(40, 140);
      await page.mouse.down();
      await page.mouse.move(300, 230, { steps: 4 });
      await page.mouse.up();
      await o.texts.nth(0).fill('Make the title larger');
      await o.texts.nth(1).fill('Check the spacing in this area');
      await o.send.hover();
      await expect(page.locator('[role=tooltip]:visible')).toContainText('Save the comments');
      await shot('02-pending-export');

      // 3. After Export: the Claude Code sentence with its copy button, and the saved list.
      await o.send.click();
      await expect(page.locator('[data-ce=toast-copy]')).toBeVisible();
      await o.sent.first().locator('[data-ce=sent-resolve]').click();
      await page.mouse.move(5, 5);
      await shot('03-exported');

      // 4. Help sheet, first tab.
      await page.locator('[data-ce=help-open]').click();
      await shot('04-help-extension-only');
    } finally {
      await h.cleanup();
    }
  });
}

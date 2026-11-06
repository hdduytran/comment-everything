import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, ui } from './harness.js';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.describe('Markdown viewer', () => {
  test('comments map to the right source lines; Copy prompt matches the snapshot', async ({
    page,
    project,
  }) => {
    await page.goto(project.open('guide.md'));
    const o = ui(page);
    const article = page.locator('article.ce-markdown');
    await expect(article.locator('h1')).toHaveText('Guide');
    // Mermaid is lazy-loaded and must render under the viewer's strict CSP.
    await expect(article.locator('pre.mermaid svg')).toBeVisible({ timeout: 30_000 });

    // 1) Element pick on the two-line paragraph (lines 3-4).
    await o.mode('element').click();
    await article.locator('p').first().click();
    // 2) Element pick on the second list item (line 9).
    await article.locator('li').nth(1).click();
    await expect(o.drafts).toHaveCount(2);

    // 3) Text selection inside the code fence: only "const b = 2;" (line 13).
    await o.mode('text').click();
    await page.evaluate(() => {
      const code = document.querySelector('article pre code')!;
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      const target = 'const b = 2;';
      const full = code.textContent ?? '';
      const from = full.indexOf(target);
      const to = from + target.length;
      const range = document.createRange();
      let pos = 0;
      let startSet = false;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const len = (n.nodeValue ?? '').length;
        if (!startSet && from < pos + len) {
          range.setStart(n, from - pos);
          startSet = true;
        }
        if (startSet && to <= pos + len) {
          range.setEnd(n, to - pos);
          break;
        }
        pos += len;
      }
      const sel = getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await expect(o.drafts).toHaveCount(3);
    await expect(page.getByTestId('ce-pin-3')).toBeVisible();

    // Copy prompt before sending: deterministic Markdown for the three pending comments.
    await o.texts.nth(0).fill('Merge these two lines');
    await o.texts.nth(1).fill('Rename step two');
    await o.texts.nth(2).fill('Use let instead of const');
    await o.copy.click();
    await expect(o.toast).toContainText('copied');
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(prompt).toMatchSnapshot('copy-prompt.txt');

    await o.send.click();
    await expect(o.toast).toContainText(/^(Sent|Saved)/);
    const [para, item, code] = await project.comments();
    expect(para).toMatchObject({ source: 'guide.md' });
    expect(para!.selectors[0]).toEqual({ type: 'LineRangeSelector', startLine: 3, endLine: 4 });
    expect(para!.selectors[1]).toMatchObject({
      type: 'TextQuoteSelector',
      exact: 'Intro line one\nintro line two',
    });
    expect(item!.selectors[0]).toEqual({ type: 'LineRangeSelector', startLine: 9, endLine: 9 });
    expect(code!.selectors[0]).toEqual({ type: 'LineRangeSelector', startLine: 13, endLine: 13 });
    expect(code!.selectors[1]).toMatchObject({ type: 'TextQuoteSelector', exact: 'const b = 2;' });
  });

  test('re-renders when the file changes on disk', async ({ page, project }) => {
    await page.goto(project.open('guide.md'));
    const article = page.locator('article.ce-markdown');
    await expect(article.locator('h1')).toHaveText('Guide');
    const file = path.join(project.dir, 'guide.md');
    await writeFile(file, (await readFile(file, 'utf8')).replace('# Guide', '# Guide v2'));
    await expect(article.locator('h1')).toHaveText('Guide v2');
    // The overlay survives the re-render.
    await expect(ui(page).send).toBeDisabled();
  });
});

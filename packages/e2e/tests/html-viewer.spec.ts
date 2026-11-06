import { open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, ui, writeAndSend } from './harness.js';

test.describe('HTML viewer', () => {
  test('comments on 3 elements and Send writes 3 JSON files with correct selectors', async ({
    page,
    project,
  }) => {
    await page.goto(project.open('page.html'));
    const frame = page.frameLocator('iframe.ce-html-frame');
    const o = ui(page);

    // The frame agent has started once it has created its pin layer host.
    await expect(frame.locator('[data-ce-host]').first()).toBeAttached();
    await o.mode('element').click();
    await expect(frame.locator('[data-ce-host]')).toHaveCount(2); // pin layer + picker

    await frame.locator('#title').click();
    await frame.locator('#cta').click();
    await frame.locator('li').nth(1).click();
    await expect(o.drafts).toHaveCount(3);
    await expect(frame.getByTestId('ce-pin-3')).toBeVisible();
    // Picking swallows the click: the page's own handler must not fire.
    expect(
      await frame
        .locator('body')
        .evaluate(() => (window as never as { __clicked?: boolean }).__clicked),
    ).toBeUndefined();

    await writeAndSend(page, ['Make the title larger', 'Rename the button', 'Typo in item']);

    const comments = await project.comments();
    expect(comments).toHaveLength(3);
    const [title, cta, li] = comments;
    expect(title).toMatchObject({
      source: 'page.html',
      text: 'Make the title larger',
      status: 'open',
    });
    expect(title!.selectors).toEqual(
      expect.arrayContaining([
        { type: 'CssSelector', value: '#title' },
        { type: 'XPathSelector', value: '//*[@id="title"]' },
        expect.objectContaining({ type: 'TextQuoteSelector', exact: 'Fixture page' }),
      ]),
    );
    expect(cta!.selectors).toContainEqual({ type: 'CssSelector', value: '#cta' });
    expect(cta!.selectors).toContainEqual(
      expect.objectContaining({ type: 'TextQuoteSelector', exact: 'Buy now' }),
    );
    // The stored CSS selector must round-trip to the picked element in the real page.
    const liCss = (li!.selectors.find((s) => s.type === 'CssSelector') as { value: string }).value;
    await expect(frame.locator(liCss)).toHaveText('beta item');
    const liXpath = (li!.selectors.find((s) => s.type === 'XPathSelector') as { value: string })
      .value;
    await expect(frame.locator(`xpath=${liXpath}`)).toHaveText('beta item');

    // Live status: an agent resolving a comment shows up in the panel without a reload.
    const res = await fetch(`${project.daemon.url}/comments/${title!.id}`, {
      method: 'PATCH',
      headers: { 'x-ce-token': project.daemon.token, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved', resolution: 'Set font-size to 3rem' }),
    });
    expect(res.status).toBe(200);
    await expect(o.sent.filter({ hasText: 'Make the title larger' })).toHaveAttribute(
      'data-status',
      'resolved',
    );
    await expect(page.locator('[data-ce=note]')).toHaveText('Agent: Set font-size to 3rem');
  });

  test('text selection and region screenshot produce quote and screenshot selectors', async ({
    page,
    project,
  }) => {
    await page.goto(project.open('page.html'));
    const frame = page.frameLocator('iframe.ce-html-frame');
    const o = ui(page);
    await expect(frame.locator('[data-ce-host]').first()).toBeAttached();

    await o.mode('text').click();
    // Double-click the first word (the paragraph is block-wide, so its centre is empty space).
    await frame.locator('#intro').dblclick({ position: { x: 20, y: 10 } });
    await expect(o.drafts).toHaveCount(1);

    await o.mode('region').click();
    await expect(frame.locator('[data-ce-host]')).toHaveCount(2);
    const box = (await page.locator('iframe.ce-html-frame').boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 330, box.y + 140, { steps: 5 });
    await page.mouse.up();
    await expect(o.drafts).toHaveCount(2, { timeout: 20_000 });

    await writeAndSend(page, ['Check this word', 'This area looks off']);
    const [word, region] = await project.comments();

    const quote = word!.selectors.find((s) => s.type === 'TextQuoteSelector') as { exact: string };
    expect('Welcome to the fixture page used by end-to-end tests.').toContain(quote.exact);
    expect(word!.selectors.map((s) => s.type)).toEqual([
      'TextQuoteSelector',
      'TextPositionSelector',
      'CssSelector',
    ]);

    const shot = region!.selectors.find((s) => s.type === 'ScreenshotSelector') as {
      rect: { width: number; height: number };
      asset: string;
    };
    expect(shot.rect.width).toBeGreaterThan(250);
    expect(region!.assets).toEqual([shot.asset]);
    const file = path.join(project.dir, '.comments', shot.asset);
    expect((await stat(file)).size).toBeGreaterThan(200);
    const handle = await open(file);
    const header = Buffer.alloc(24);
    await handle.read(header, 0, 24, 0);
    await handle.close();
    expect(header.subarray(1, 4).toString()).toBe('PNG');
    expect(header.readUInt32BE(16)).toBe(shot.rect.width); // IHDR width matches the region
    expect(header.readUInt32BE(20)).toBe(shot.rect.height);
  });

  test('reloads after the file changes and keeps pending pins', async ({ page, project }) => {
    await page.goto(project.open('page.html'));
    const frame = page.frameLocator('iframe.ce-html-frame');
    const o = ui(page);
    await expect(frame.locator('[data-ce-host]').first()).toBeAttached();
    await o.mode('element').click();
    await expect(frame.locator('[data-ce-host]')).toHaveCount(2);
    await frame.locator('#title').click();
    await expect(frame.getByTestId('ce-pin-1')).toBeVisible();

    const file = path.join(project.dir, 'page.html');
    const html = await readFile(file, 'utf8');
    await writeFile(
      file,
      html.replace('<h1 id="title">Fixture page</h1>', '<h1 id="title">Edited by agent</h1>'),
    );
    await expect(frame.locator('#title')).toHaveText('Edited by agent');
    await expect(frame.getByTestId('ce-pin-1')).toBeVisible();
    await expect(o.drafts).toHaveCount(1);
  });

  test('project HTML stays sandboxed and cannot reach the viewer or the daemon API', async ({
    page,
    project,
  }) => {
    await page.goto(project.open('page.html'));
    const frameEl = page.locator('iframe.ce-html-frame');
    await expect(frameEl).toHaveAttribute('sandbox', /allow-scripts/);
    expect(await frameEl.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(await frameEl.evaluate((f: HTMLIFrameElement) => f.contentDocument)).toBeNull();

    const frame = page.frames().find((f) => f !== page.mainFrame())!;
    await expect(frame.locator('[data-ce-host]').first()).toBeAttached();
    const probe = await frame.evaluate(async (base) => {
      const out: Record<string, unknown> = {};
      try {
        out.parent = window.parent.document.title;
      } catch {
        out.parent = 'blocked';
      }
      try {
        out.api = (await fetch(`${base}/comments`)).status;
      } catch {
        out.api = 'blocked';
      }
      out.agentSrc = (
        document.querySelector('script[src*="frame-agent"]') as HTMLScriptElement
      ).src;
      return out;
    }, project.daemon.url);
    expect(probe.parent).toBe('blocked');
    expect(probe.api).not.toBe(200);
    expect(String(probe.agentSrc)).toBe(`${project.daemon.url}/_ce/frame-agent.js`);
    expect(String(probe.agentSrc)).not.toContain(project.daemon.token);
  });
});

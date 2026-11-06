import { expect, test, ui, writeAndSend } from './harness.js';

/** Call the daemon the way an MCP client's proxy would. */
async function asAgent(
  daemon: { url: string; token: string },
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(daemon.url + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-ce-token': daemon.token, 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test.describe('Send to Claude', () => {
  test('the panel explains how Claude gets the comments, for each connection state', async ({
    page,
    project,
  }) => {
    await page.goto(project.open('page.html'));
    const frame = page.frameLocator('iframe.ce-html-frame');
    const o = ui(page);
    const status = page.locator('[data-ce=agent-status]');
    const toast = page.locator('[data-ce=toast] .toast-text');
    await expect(status).toHaveText('No AI connected');

    const comment = async (text: string) => {
      if ((await o.mode('element').getAttribute('aria-pressed')) !== 'true') {
        await o.mode('element').click();
      }
      await frame.locator('#title').click();
      await writeAndSend(page, [text]);
    };

    // 1. Nobody connected: saved, with a way to connect.
    await comment('First');
    await expect(toast).toHaveText('Saved. Connect Claude:');
    await page.locator('[data-ce=toast-connect]').click();
    const help = page.locator('[data-ce=help]');
    await expect(help).toBeVisible();
    await expect(help).toContainText('claude mcp add comment-everything -- comment-everything mcp');
    await page.locator('[data-ce=help-tab-desktop]').click();
    await expect(help).toContainText('comment-everything init --write-desktop-config');
    await page.locator('[data-ce=help-tab-other]').click();
    await expect(help).toContainText('comment-everything mcp');
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();

    // 2. A client is connected but not waiting.
    const agent = { 'x-ce-agent': 'stdio:e2e' };
    await asAgent(project.daemon, '/agents/hello', {
      id: 'stdio:e2e',
      name: 'claude-code',
      transport: 'stdio',
    });
    await expect(status).toHaveText('Claude Code connected (will read on request)');
    await comment('Second');
    await expect(toast).toContainText('In Claude, run /comments');

    // 3. The client waits in wait_for_comments (batches queued by earlier tests are drained first).
    for (let i = 0; i < 200; i++) {
      if (
        (await asAgent(project.daemon, '/batches/next?timeoutSec=1', undefined, agent)).status ===
        204
      )
        break;
    }
    const waiting = asAgent(project.daemon, '/batches/next?timeoutSec=15', undefined, agent);
    await expect(status).toHaveText('Claude Code connected · watching');
    await comment('Third');
    await expect(toast).toHaveText('Sent — Claude is picking it up');
    expect((await waiting).status).toBe(200);
    await expect(status).toHaveText('Claude Code connected (will read on request)');

    await asAgent(project.daemon, '/agents/bye', { id: 'stdio:e2e' });
    await expect(status).toHaveText('No AI connected');
  });

  test('controls have tooltips on hover and keyboard focus; Esc dismisses', async ({
    page,
    project,
  }) => {
    await page.goto(project.open('page.html'));
    const send = ui(page).send;
    await expect(send).toHaveAttribute('aria-describedby', /ce-tip-/);
    const tip = page.locator('[role=tooltip]').filter({ hasText: 'Nothing to send yet' });
    await expect(tip).toBeHidden();
    await send.hover();
    await expect(tip).toBeVisible(); // after the ~400ms delay
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
    await page.mouse.move(5, 5);
    await ui(page).mode('text').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('[role=tooltip]:visible')).toHaveCount(1);
  });

  test('the panel collapses to a handle and the page uses the full width', async ({
    page,
    project,
  }) => {
    await page.goto(project.open('page.html'));
    const frame = page.locator('iframe.ce-html-frame');
    const before = (await frame.boundingBox())!.width;
    await page.locator('[data-ce=collapse]').click();
    await expect(page.locator('[data-ce=handle]')).toBeVisible();
    await expect(ui(page).send).toBeHidden();
    expect((await frame.boundingBox())!.width).toBeGreaterThan(before);
    await page.locator('[data-ce=handle]').click();
    await expect(ui(page).send).toBeVisible();
  });
});

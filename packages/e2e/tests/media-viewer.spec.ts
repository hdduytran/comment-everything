import { execFileSync, spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, ui, writeAndSend } from './harness.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

/** Brightness encodes time; VP8/Opus in WebM so the bundled Chromium can decode it. */
function makeWebm(file: string): void {
  execFileSync(
    'ffmpeg',
    [
      ...['-v', 'error', '-y', '-f', 'lavfi'],
      ...['-i', "color=c=black:s=160x90:r=25:d=6,geq=lum='min(255,T*40)':cb=128:cr=128"],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=6'],
      ...['-c:v', 'libvpx', '-b:v', '1M', '-c:a', 'libopus', '-shortest', file],
    ],
    { stdio: 'pipe' },
  );
}

/** Call an MCP tool on the daemon's stateless JSON endpoint. */
async function callTool(
  url: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: { type: string; mimeType?: string; text?: string }[] }> {
  const res = await fetch(`${url}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-ce-token': token,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const body = (await res.json()) as { result: { content: never[] } };
  return body.result;
}

test.describe('Media viewer', () => {
  test.skip(!hasFfmpeg, 'ffmpeg is required for the media fixture');

  test('two ranges -> Send -> keyframes on disk and images from get_comment', async ({
    page,
    project,
  }) => {
    makeWebm(path.join(project.dir, 'clip.webm'));
    await page.goto(project.open('clip.webm'));
    const o = ui(page);
    const media = page.locator('[data-ce=media-element]');
    await expect(media).toBeVisible();
    await expect
      .poll(() => media.evaluate((v: HTMLMediaElement) => v.readyState))
      .toBeGreaterThan(0);
    await expect(page.locator('[data-ce=waveform]')).toBeVisible();

    // Range 1: in/out keys at the playhead (1.0 s -> 3.0 s).
    await media.evaluate((v: HTMLMediaElement) => (v.currentTime = 1));
    await page.keyboard.press('[');
    await media.evaluate((v: HTMLMediaElement) => (v.currentTime = 3));
    await page.keyboard.press(']');
    await expect(o.drafts).toHaveCount(1);

    // Range 2: drag across the waveform.
    const box = (await page.locator('[data-ce=waveform] > div').first().boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.6, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, y, { steps: 8 });
    await page.mouse.up();
    await expect(o.drafts).toHaveCount(2);
    await expect(o.drafts.nth(0)).toContainText('00:01.000–00:03.000');

    await writeAndSend(page, ['Trim the intro', 'Fix the audio level here']);

    // Keyframes are produced asynchronously by the daemon after Send.
    await expect
      .poll(async () => (await project.comments()).map((c) => c.assets.length), { timeout: 20_000 })
      .toEqual([3, 3]);
    const stored = await project.comments();
    for (const c of stored) {
      expect(c.selectors[0]).toMatchObject({ type: 'FragmentSelector' });
      for (const a of c.assets) await access(path.join(project.dir, '.comments', a));
    }

    const result = await callTool(project.daemon.url, project.daemon.token, 'get_comment', {
      id: stored[0]!.id,
    });
    const images = result.content.filter((c) => c.type === 'image');
    expect(images).toHaveLength(3);
    expect(images[0]!.mimeType).toBe('image/jpeg');
    expect(result.content[0]!.text).toContain('Trim the intro');
  });
});

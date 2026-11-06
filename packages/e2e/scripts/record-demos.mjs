// Records the two README demos (HTML/Markdown flow, video flow) against the built CLI with
// Playwright, then converts the WebM captures to GIFs with ffmpeg into docs/assets/.
// Prerequisites: `pnpm -r build`, Playwright's chromium, ffmpeg on PATH.
// Run: pnpm --filter @comment-everything/e2e record-demos
import { chromium } from '@playwright/test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const REPO = path.resolve(HERE, '..', '..', '..');
const CLI = path.join(REPO, 'packages', 'cli', 'dist', 'cli.js');
const DEMO = path.join(HERE, '..', 'demo');
const OUT = path.join(REPO, 'docs', 'assets');
const SIZE = { width: 960, height: 540 };
const MAX_GIF_BYTES = 5 * 1024 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Start a real daemon (own home dir, free port) through the built CLI. */
async function startDaemon(home) {
  const child = spawn(process.execPath, [CLI, 'serve', '--port', '0'], {
    env: { ...process.env, COMMENT_EVERYTHING_HOME: home },
    stdio: 'ignore',
  });
  const lock = await waitFor(
    async () =>
      JSON.parse(await readFile(path.join(home, '.comment-everything', 'daemon.json'), 'utf8')),
    'daemon lockfile',
  );
  return {
    url: `http://127.0.0.1:${lock.port}`,
    token: lock.token,
    async stop() {
      child.kill('SIGTERM');
      await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
    },
  };
}

/** Viewer URL for a project file, as printed by `comment-everything open`. */
function viewerUrl(home, file) {
  const res = spawnSync(process.execPath, [CLI, 'open', file, '--no-open'], {
    env: { ...process.env, COMMENT_EVERYTHING_HOME: home },
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`open failed: ${res.stderr || res.stdout}`);
  return res.stdout.trim().split('\n').pop();
}

/** Play the part of the agent: resolve every open comment through the REST API. */
async function resolveAll(daemon, note) {
  const headers = { 'x-ce-token': daemon.token, 'content-type': 'application/json' };
  const { comments } = await (
    await fetch(`${daemon.url}/comments?status=open`, { headers })
  ).json();
  for (const c of comments) {
    await fetch(`${daemon.url}/comments/${c.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'resolved', resolution: note(c) }),
    });
  }
}

async function typeComment(page, index, text) {
  const box = page.locator('[data-ce=draft-text]').nth(index);
  await box.click();
  await box.pressSequentially(text, { delay: 45 });
}

async function send(page, count) {
  await sleep(500);
  await page.locator('[data-ce=send]').click();
  await page
    .locator('[data-ce=toast]')
    .filter({ hasText: `Sent ${count}` })
    .waitFor();
  await sleep(1200);
}

async function htmlAndMarkdownDemo(page, daemon, project, home) {
  const ui = (m) => page.locator(`[data-ce=mode-${m}]`);
  await page.goto(viewerUrl(home, path.join(project, 'landing.html')));
  const frame = page.frameLocator('iframe.ce-html-frame');
  await frame.locator('[data-ce-host]').first().waitFor({ state: 'attached' });
  await sleep(1000);
  await ui('element').click();
  await frame.locator('#headline').click();
  await typeComment(page, 0, 'Make the headline punchier');
  await frame.locator('#cta').click();
  await typeComment(page, 1, 'Say "Start free" instead');
  await send(page, 2);
  await resolveAll(daemon, (c) =>
    c.text.includes('headline')
      ? 'Headline is now "Ship in half the time"'
      : 'Button label changed to "Start free"',
  );
  await sleep(2000);

  await page.goto(viewerUrl(home, path.join(project, 'release-notes.md')));
  await page.locator('article.ce-markdown h1').waitFor();
  await sleep(800);
  await ui('element').click();
  await page.locator('article.ce-markdown p').first().click();
  await typeComment(page, 0, 'Quantify "much faster": how many ms?');
  await send(page, 1);
  await resolveAll(daemon, () => 'Added "cold start dropped from 2.1s to 0.6s"');
  await sleep(2500);
}

async function videoDemo(page, daemon, project, home) {
  await page.goto(viewerUrl(home, path.join(project, 'demo-clip.webm')));
  const media = page.locator('[data-ce=media-element]');
  await media.waitFor();
  await page.locator('[data-ce=waveform]').waitFor();
  await sleep(1500);
  const setTime = (t) =>
    media.evaluate((v, time) => {
      v.currentTime = time;
    }, t);
  await setTime(2);
  await page.keyboard.press('[');
  await sleep(500);
  await setTime(4.5);
  await page.keyboard.press(']');
  await sleep(500);
  // Second range: drag across the waveform (the in/out keys are ignored while a draft has focus).
  const box = await page.locator('[data-ce=waveform] > div').first().boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.62, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.78, y, { steps: 12 });
  await page.mouse.up();
  await sleep(500);
  await typeComment(page, 0, 'Trim this part, it drags');
  await typeComment(page, 1, 'Audio is too quiet here');
  await send(page, 2);
  await sleep(4000); // keyframes appear on the comments once ffmpeg finishes
  await resolveAll(daemon, (c) =>
    c.text.includes('Trim') ? 'Cut 00:02-00:04.5 (ffmpeg -ss/-to)' : 'Raised gain by 6 dB',
  );
  await sleep(2500);
}

function toGif(webm, gif) {
  const filter =
    'fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4';
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', webm, '-vf', filter, '-loop', '0', gif]);
}

async function record(name, browser, home, daemon, project, run) {
  const videoDir = await mkdtemp(path.join(tmpdir(), 'ce-demo-video-'));
  const context = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir: videoDir, size: SIZE },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  try {
    await run(page, daemon, project, home);
  } finally {
    await context.close(); // flushes the video file
  }
  const [webm] = (await readdir(videoDir)).filter((f) => f.endsWith('.webm'));
  const gif = path.join(OUT, `${name}.gif`);
  toGif(path.join(videoDir, webm), gif);
  await rm(videoDir, { recursive: true, force: true });
  const { size } = await stat(gif);
  console.log(`${gif}: ${(size / 1024 / 1024).toFixed(2)} MB`);
  if (size > MAX_GIF_BYTES)
    throw new Error(`${name}.gif exceeds 5 MB; shorten the demo or lower fps`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'ce-demo-home-')));
  const project = await realpath(await mkdtemp(path.join(tmpdir(), 'ce-demo-project-')));
  await cp(DEMO, project, { recursive: true });
  await mkdir(path.join(project, '.comments'));
  // 12 s test pattern with a tone so the waveform has something to draw (VP8/Opus plays in Chromium).
  execFileSync('ffmpeg', [
    ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=480x270:rate=25:duration=12'],
    ...['-f', 'lavfi', '-i', 'sine=frequency=330:duration=12'],
    ...[
      '-c:v',
      'libvpx',
      '-b:v',
      '800k',
      '-c:a',
      'libopus',
      '-shortest',
      path.join(project, 'demo-clip.webm'),
    ],
  ]);

  const daemon = await startDaemon(home);
  const browser = await chromium.launch({ headless: true });
  try {
    await record('demo-html-markdown', browser, home, daemon, project, htmlAndMarkdownDemo);
    await rm(path.join(project, '.comments'), { recursive: true, force: true });
    await mkdir(path.join(project, '.comments'));
    await record('demo-video', browser, home, daemon, project, videoDemo);
  } finally {
    await browser.close();
    await daemon.stop();
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

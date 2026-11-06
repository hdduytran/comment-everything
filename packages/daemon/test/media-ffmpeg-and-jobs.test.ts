import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractClip, extractFrame, probeDuration } from '../src/ffmpeg-keyframe-extractor.js';
import { MEDIA_ENRICH_JOB, detectMediaTools, type Job, type MediaTools } from '../src/index.js';
import { buildThumbnailSprite, detectSceneCuts } from '../src/scene-cut-detector.js';
import { createTestEnv, type TestEnv } from './helpers.js';
import {
  HAS_FFMPEG,
  WHISPER_FIXTURE,
  makeTimecodeVideo,
  makeTwoSceneVideo,
  timecodesOfFrames,
} from './media-fixtures.js';

const ffmpeg = HAS_FFMPEG ? detectMediaTools() : null;

describe.skipIf(!HAS_FFMPEG)('ffmpeg helpers', () => {
  let dir: string;
  let video: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ce-ffmpeg-'));
    video = path.join(dir, 'timecode.mp4');
    makeTimecodeVideo(video);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('extracts keyframes whose timecode matches the requested time within 0.1 s', async () => {
    const times = [0, 1, 2.48, 3.2, 5.0];
    const jpgs: string[] = [];
    for (const [i, t] of times.entries()) {
      const file = path.join(dir, `k${i}.jpg`);
      await writeFile(file, await extractFrame(ffmpeg!.ffmpeg!, video, t));
      jpgs.push(file);
    }
    const found = timecodesOfFrames(video, jpgs);
    times.forEach((t, i) => expect(Math.abs(found[i]! - t)).toBeLessThanOrEqual(0.1));
  });

  it('probes duration, detects a hard scene cut and builds a thumbnail strip', async () => {
    expect(await probeDuration(ffmpeg!.ffprobe!, video)).toBeCloseTo(6, 1);
    const scenes = path.join(dir, 'scenes.mp4');
    makeTwoSceneVideo(scenes);
    const cuts = await detectSceneCuts(ffmpeg!.ffmpeg!, scenes);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toBeCloseTo(1.5, 1);
    const sprite = await buildThumbnailSprite(ffmpeg!.ffmpeg!, ffmpeg!.ffprobe!, video);
    expect(sprite.frames).toBe(24);
    expect(sprite.jpeg[0]).toBe(0xff);
  });

  it('exports a clip without re-encoding', async () => {
    const clip = await extractClip(ffmpeg!.ffmpeg!, video, 1, 3);
    expect(clip.byteLength).toBeGreaterThan(500);
  });
});

async function waitForEnrichJobs(env: TestEnv): Promise<Job[]> {
  const jobs = env.daemon.jobs.list().filter((j) => j.type === MEDIA_ENRICH_JOB);
  return Promise.all(jobs.map((j) => env.daemon.jobs.waitFor(j.id)));
}

const batchBody = (project: string, source: string, ranges: [number, number?][]) => ({
  root: project,
  comments: ranges.map(([s, e], i) => ({
    source,
    text: `comment ${i}`,
    selectors: [{ type: 'FragmentSelector', value: `t=${s}${e === undefined ? '' : `,${e}`}` }],
  })),
});

describe.skipIf(!HAS_FFMPEG)('media send pipeline', () => {
  let env: TestEnv;
  let fakeDir: string;
  let fakeWhisper: string;
  const tools = (): MediaTools => detectMediaTools();
  let current: () => MediaTools = tools;

  beforeAll(async () => {
    env = await createTestEnv({ mediaTools: () => current() });
    makeTimecodeVideo(path.join(env.project, 'clip.mp4'));
    fakeDir = await mkdtemp(path.join(tmpdir(), 'ce-fake-whisper-'));
    fakeWhisper = path.join(fakeDir, 'whisper-cli');
    // Mimics `whisper-cli -m model -f wav -oj -of <prefix>`: writes <prefix>.json.
    await writeFile(
      fakeWhisper,
      `#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = "-of" ] && out="$2"; shift; done\ncat > "$out.json" <<'EOF'\n${WHISPER_FIXTURE}\nEOF\n`,
    );
    await chmod(fakeWhisper, 0o755);
  });
  afterAll(async () => {
    await env.cleanup();
    await rm(fakeDir, { recursive: true, force: true });
  });

  it('adds three keyframes per range, a single one per point, and get_comment sees them', async () => {
    current = tools;
    const res = await env.api('/comments', {
      method: 'POST',
      body: JSON.stringify(batchBody(env.project, 'clip.mp4', [[1, 3], [4.5]])),
    });
    expect(res.status).toBe(201);
    const batch = (await res.json()) as { comments: { id: string }[] };
    const jobs = await waitForEnrichJobs(env);
    expect(jobs.every((j) => j.status === 'succeeded')).toBe(true);

    const range = (await (await env.api(`/comments/${batch.comments[0]!.id}`)).json()) as {
      assets: string[];
    };
    expect(range.assets).toHaveLength(3);
    ['-1.000.jpg', '-2.000.jpg', '-3.000.jpg'].forEach((suffix, i) =>
      expect(range.assets[i]).toMatch(new RegExp(`^assets/.+${suffix.replace('.', '\\.')}$`)),
    );
    for (const a of range.assets) {
      expect((await stat(path.join(env.project, '.comments', a))).size).toBeGreaterThan(100);
      const asset = await env.api(
        `/comments/${batch.comments[0]!.id}/asset?path=${encodeURIComponent(a)}`,
      );
      expect(asset.headers.get('content-type')).toBe('image/jpeg');
    }
    const point = (await (await env.api(`/comments/${batch.comments[1]!.id}`)).json()) as {
      assets: string[];
    };
    expect(point.assets).toHaveLength(1);
  });

  it('attaches overlapping transcript segments when whisper is available', async () => {
    current = () => ({ ...detectMediaTools(), whisper: fakeWhisper, whisperModel: '/fake/model' });
    const before = env.daemon.jobs.list().length;
    const res = await env.api('/comments', {
      method: 'POST',
      body: JSON.stringify(batchBody(env.project, 'clip.mp4', [[2, 3]])),
    });
    const { comments } = (await res.json()) as { comments: { id: string }[] };
    const done = await waitForEnrichJobs(env);
    expect(done.map((j) => j.error).filter(Boolean)).toEqual([]);
    expect(env.daemon.jobs.list().length).toBe(before + 1);
    const c = (await (await env.api(`/comments/${comments[0]!.id}`)).json()) as {
      transcript?: { text: string; segments: unknown[] };
    };
    expect(c.transcript?.text).toBe('Hello and welcome. This is the second sentence.');
    // A second comment on the same file reuses the cached transcript.
    const cached = await readFile(
      path.join(env.home, '.comment-everything', 'cache', (await cacheFile(env)) ?? ''),
      'utf8',
    );
    expect(JSON.parse(cached)).toHaveLength(3);
  });

  it('still saves comments and reports the install hint when ffmpeg is missing', async () => {
    current = () => ({ ffmpeg: null, ffprobe: null, whisper: null, whisperModel: null });
    const res = await env.api('/comments', {
      method: 'POST',
      body: JSON.stringify(batchBody(env.project, 'clip.mp4', [[1, 2]])),
    });
    expect(res.status).toBe(201);
    const { comments } = (await res.json()) as { comments: { id: string }[] };
    await waitForEnrichJobs(env);
    const job = env.daemon.jobs
      .list()
      .find((j) => (j.payload as { commentId: string }).commentId === comments[0]!.id)!;
    expect((job.result as { skipped: string[] }).skipped[0]).toMatch(/brew install ffmpeg/);
    const saved = (await (await env.api(`/comments/${comments[0]!.id}`)).json()) as {
      assets: string[];
    };
    expect(saved.assets).toEqual([]);
    const caps = (await (await env.api('/media/capabilities')).json()) as { ffmpeg: boolean };
    expect(caps.ffmpeg).toBe(false);
    current = tools;
  });

  it('serves thumbnails and scene cuts, and refuses non-media or escaping paths', async () => {
    current = tools;
    const q = (p: string) => `rootId=${env.rootId}&path=${encodeURIComponent(p)}`;
    const thumbs = await env.api(`/media/thumbnails?${q('clip.mp4')}`);
    expect(thumbs.status).toBe(200);
    expect(thumbs.headers.get('x-ce-frames')).toBe('24');
    const scenes = await env.api(`/media/scenes?${q('clip.mp4')}`);
    expect(((await scenes.json()) as { cuts: number[] }).cuts).toBeInstanceOf(Array);
    expect((await env.api(`/media/scenes?${q('index.html')}`)).status).toBe(400);
    expect((await env.api(`/media/scenes?${q('../secret.mp4')}`)).status).toBe(403);
    expect((await env.api('/media/scenes')).status).toBe(400);
  });
});

async function cacheFile(env: TestEnv): Promise<string | undefined> {
  const { readdir } = await import('node:fs/promises');
  const dir = path.join(env.home, '.comment-everything', 'cache');
  return (await readdir(dir)).find((n) => n.endsWith('.transcript.json'));
}

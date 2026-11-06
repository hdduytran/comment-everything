import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { probeDuration } from './ffmpeg-keyframe-extractor.js';
import { runBinary } from './media-binaries.js';

export const SCENE_THRESHOLD = 0.3;
export const SPRITE_FRAMES = 24;
export const SPRITE_THUMB = { width: 160, height: 90 };

/** Pull `pts_time` values out of ffmpeg `showinfo` log lines, ascending and de-duplicated. */
export function parseSceneCuts(log: string): number[] {
  const times = new Set<number>();
  for (const line of log.split('\n')) {
    if (!line.includes('showinfo')) continue;
    const m = /pts_time:\s*(\d+(?:\.\d+)?)/.exec(line);
    if (m) times.add(Math.round(Number(m[1]) * 1000) / 1000);
  }
  return [...times].sort((a, b) => a - b);
}

/** Scene-change timestamps (seconds) using ffmpeg's `scene` score. */
export async function detectSceneCuts(
  ffmpeg: string,
  file: string,
  threshold = SCENE_THRESHOLD,
): Promise<number[]> {
  const { stderr } = await runBinary(
    ffmpeg,
    [
      ...['-v', 'info', '-nostats', '-i', file, '-an'],
      ...['-vf', `select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'],
    ],
    { timeoutMs: 300_000 },
  );
  return parseSceneCuts(stderr);
}

export interface ThumbnailSprite {
  jpeg: Uint8Array;
  frames: number;
  duration: number;
  thumbWidth: number;
  thumbHeight: number;
}

/** One horizontal JPEG strip of `SPRITE_FRAMES` evenly spaced thumbnails. */
export async function buildThumbnailSprite(
  ffmpeg: string,
  ffprobe: string,
  file: string,
): Promise<ThumbnailSprite> {
  const duration = await probeDuration(ffprobe, file);
  const { width, height } = SPRITE_THUMB;
  const dir = await mkdtemp(path.join(tmpdir(), 'ce-sprite-'));
  const out = path.join(dir, 'sprite.jpg');
  try {
    const filter = [
      `fps=${SPRITE_FRAMES}/${Math.max(duration, 0.1)}`,
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      `tile=${SPRITE_FRAMES}x1`,
    ].join(',');
    await runBinary(
      ffmpeg,
      ['-v', 'error', '-y', '-i', file, '-an', '-vf', filter, '-frames:v', '1', '-q:v', '5', out],
      { timeoutMs: 180_000 },
    );
    return {
      jpeg: new Uint8Array(await readFile(out)),
      frames: SPRITE_FRAMES,
      duration,
      thumbWidth: width,
      thumbHeight: height,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

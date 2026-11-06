import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runBinary } from './media-binaries.js';

/** Start, middle and end of a range; a point (or inverted) range yields a single time. */
export function keyframeTimes(start: number, end?: number): number[] {
  if (end === undefined || end <= start) return [start];
  return [start, (start + end) / 2, end];
}

/** `12.400` style label used in asset file names. */
export const timeLabel = (t: number) => t.toFixed(3);

/** Read the media duration in seconds with ffprobe. */
export async function probeDuration(ffprobe: string, file: string): Promise<number> {
  const { stdout } = await runBinary(
    ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { timeoutMs: 30_000 },
  );
  const sec = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(sec)) throw new Error('Could not read the media duration');
  return sec;
}

/** Run ffmpeg with a temp output file and return its bytes. */
async function withTempOutput(
  ffmpeg: string,
  name: string,
  buildArgs: (out: string) => string[],
  timeoutMs: number,
): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ce-media-'));
  const out = path.join(dir, name);
  try {
    await runBinary(ffmpeg, ['-v', 'error', '-y', ...buildArgs(out)], { timeoutMs });
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Decode the single frame at `timeSec` as a JPEG. `-ss` before `-i` seeks to the nearest
 * earlier keyframe and then decodes up to the exact time, so the frame is accurate to one frame.
 */
export function extractFrame(ffmpeg: string, file: string, timeSec: number): Promise<Uint8Array> {
  return withTempOutput(
    ffmpeg,
    'frame.jpg',
    (out) => ['-ss', String(Math.max(0, timeSec)), '-i', file, '-frames:v', '1', '-q:v', '3', out],
    60_000,
  );
}

/** Cut `[start, end]` into an mp4 without re-encoding (`-c copy`; cuts land on keyframes). */
export function extractClip(
  ffmpeg: string,
  file: string,
  start: number,
  end: number,
): Promise<Uint8Array> {
  return withTempOutput(
    ffmpeg,
    'clip.mp4',
    (out) => [
      ...['-ss', String(start), '-to', String(end), '-i', file],
      ...['-c', 'copy', '-movflags', '+faststart', out],
    ],
    120_000,
  );
}

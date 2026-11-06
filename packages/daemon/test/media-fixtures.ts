import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findBinary } from '../src/media-binaries.js';

export const HAS_FFMPEG = findBinary('ffmpeg') !== null;

export const FIXTURE_FPS = 25;
export const FIXTURE_SECONDS = 6;

/**
 * Generate a clip whose frame brightness encodes its timecode: luma = 40 * t (clamped), so the
 * time of any extracted frame can be recovered by matching it against the video's own frames.
 * (This ffmpeg build has no `drawtext`, so a burned-in digit overlay is not available.)
 * `-g` is left at the encoder default on purpose: one keyframe, so every seek must decode forward.
 */
export function makeTimecodeVideo(file: string, container: 'mp4' | 'webm' = 'mp4'): void {
  const codec = container === 'webm' ? ['-c:v', 'libvpx', '-b:v', '1M'] : ['-c:v', 'libx264'];
  execFileSync(
    'ffmpeg',
    [
      ...['-v', 'error', '-y', '-f', 'lavfi'],
      ...[
        '-i',
        `color=c=black:s=64x64:r=${FIXTURE_FPS}:d=${FIXTURE_SECONDS},geq=lum='min(255,T*40)':cb=128:cr=128`,
      ],
      ...['-f', 'lavfi', '-i', `sine=frequency=440:duration=${FIXTURE_SECONDS}`],
      ...codec,
      ...['-c:a', container === 'webm' ? 'libopus' : 'aac', '-shortest'],
      ...['-pix_fmt', 'yuv420p', file],
    ],
    { stdio: 'pipe' },
  );
}

/** Two flat colours with a hard cut at 1.5 s, for scene-cut detection. */
export function makeTwoSceneVideo(file: string): void {
  execFileSync(
    'ffmpeg',
    [
      ...['-v', 'error', '-y'],
      ...['-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=25:d=1.5'],
      ...['-f', 'lavfi', '-i', 'color=c=white:s=64x64:r=25:d=1.5'],
      ...['-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]'],
      ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', file],
    ],
    { stdio: 'pipe' },
  );
}

/** Mean gray level (0-255) of every image in a sequence of JPEGs, via a single ffmpeg run. */
function meanLumas(pattern: string): number[] {
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', pattern, '-vf', 'scale=8:8', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const out: number[] = [];
  for (let i = 0; i + 64 <= raw.length; i += 64) {
    let sum = 0;
    for (let j = 0; j < 64; j++) sum += raw[i + j] ?? 0;
    out.push(sum / 64);
  }
  return out;
}

/**
 * Recover the timecode of each JPEG by matching its brightness against every frame of
 * `video` (decoded through the same JPEG path, so colour-range handling is identical).
 */
export function timecodesOfFrames(video: string, jpgs: string[]): number[] {
  const dir = mkdtempSync(path.join(tmpdir(), 'ce-ref-'));
  try {
    execFileSync(
      'ffmpeg',
      ['-v', 'error', '-i', video, '-q:v', '3', path.join(dir, 'ref_%04d.jpg')],
      { stdio: 'pipe' },
    );
    const reference = meanLumas(path.join(dir, 'ref_%04d.jpg'));
    return jpgs.map((jpg) => {
      const [luma] = meanLumas(jpg);
      let best = 0;
      reference.forEach((l, i) => {
        if (Math.abs(l - (luma ?? 0)) < Math.abs((reference[best] ?? 0) - (luma ?? 0))) best = i;
      });
      return best / FIXTURE_FPS;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as unknown;

// Shape of `whisper-cli -oj` output (whisper.cpp 1.7): offsets in ms plus clock timestamps.
export const WHISPER_FIXTURE = JSON.stringify({
  systeminfo: 'AVX = 1',
  model: { type: 'base' },
  result: { language: 'en' },
  transcription: [
    {
      timestamps: { from: '00:00:00,000', to: '00:00:02,500' },
      offsets: { from: 0, to: 2500 },
      text: ' Hello and welcome.',
    },
    {
      timestamps: { from: '00:00:02,500', to: '00:00:05,000' },
      offsets: { from: 2500, to: 5000 },
      text: ' This is the second sentence.',
    },
    {
      timestamps: { from: '00:01:05,250', to: '00:01:07,000' },
      text: ' Timestamps only.',
    },
    { offsets: { from: 1, to: 2 }, text: '   ' },
  ],
});

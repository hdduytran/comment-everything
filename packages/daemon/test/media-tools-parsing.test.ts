import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { keyframeTimes, timeLabel } from '../src/ffmpeg-keyframe-extractor.js';
import { detectMediaTools, findBinary } from '../src/media-binaries.js';
import { mediaKindOf } from '../src/media-kinds.js';
import { parseSceneCuts } from '../src/scene-cut-detector.js';
import { WHISPER_FIXTURE } from './media-fixtures.js';
import { parseWhisperJson, segmentsInRange, toTranscript } from '../src/whisper-transcriber.js';

describe('parseWhisperJson', () => {
  it('reads offsets, falls back to clock timestamps and drops empty segments', () => {
    expect(parseWhisperJson(WHISPER_FIXTURE)).toEqual([
      { start: 0, end: 2.5, text: 'Hello and welcome.' },
      { start: 2.5, end: 5, text: 'This is the second sentence.' },
      { start: 65.25, end: 67, text: 'Timestamps only.' },
    ]);
  });

  it('rejects output without a transcription array', () => {
    expect(() => parseWhisperJson('{"result":{}}')).toThrow(/Unexpected whisper output/);
  });
});

describe('segmentsInRange', () => {
  const segs = parseWhisperJson(WHISPER_FIXTURE);

  it('returns overlapping segments only', () => {
    expect(segmentsInRange(segs, 2.0, 3.0).map((s) => s.text)).toEqual([
      'Hello and welcome.',
      'This is the second sentence.',
    ]);
    expect(segmentsInRange(segs, 5.0, 6.0)).toEqual([]);
  });

  it('matches the segment containing a point comment', () => {
    expect(segmentsInRange(segs, 3.1).map((s) => s.text)).toEqual(['This is the second sentence.']);
  });

  it('builds a transcript with joined text', () => {
    expect(toTranscript(segs.slice(0, 2)).text).toBe(
      'Hello and welcome. This is the second sentence.',
    );
  });
});

describe('parseSceneCuts', () => {
  it('extracts pts_time from showinfo lines, sorted and unique', () => {
    const log = [
      'ffmpeg version 8.0',
      '[Parsed_showinfo_1 @ 0x1] n:   0 pts:  75 pts_time:3 duration: 1 fmt:yuv420p',
      '[Parsed_showinfo_1 @ 0x1] n:   1 pts:  37 pts_time:1.480 duration: 1',
      '[Parsed_showinfo_1 @ 0x1] n:   2 pts:  37 pts_time:1.48 duration: 1',
      'frame=  3 fps=0.0 q=-0.0 pts_time:99', // not a showinfo line
    ].join('\n');
    expect(parseSceneCuts(log)).toEqual([1.48, 3]);
  });
});

describe('keyframeTimes', () => {
  it('uses start, middle and end for a range and one frame for a point', () => {
    expect(keyframeTimes(12.4, 15)).toEqual([12.4, 13.7, 15]);
    expect(keyframeTimes(4)).toEqual([4]);
    expect(keyframeTimes(4, 4)).toEqual([4]);
    expect(timeLabel(12.4)).toBe('12.400');
  });
});

describe('mediaKindOf', () => {
  it('classifies by extension and ignores URLs', () => {
    expect(mediaKindOf('a/b/promo.MP4')).toBe('video');
    expect(mediaKindOf('talk.flac')).toBe('audio');
    expect(mediaKindOf('notes.md')).toBeNull();
    expect(mediaKindOf('https://example.com/video.mp4')).toBeNull();
  });
});

describe('tool detection', () => {
  it('finds executables on PATH and reports absent ones as null', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ce-bin-'));
    try {
      const bin = path.join(dir, 'whisper-cli');
      await writeFile(bin, '#!/bin/sh\n');
      await chmod(bin, 0o755);
      const env = { PATH: dir, WHISPER_MODEL: '/models/base.bin' };
      expect(findBinary('whisper-cli', env)).toBe(bin);
      expect(findBinary('ffmpeg', env)).toBeNull();
      expect(detectMediaTools(env)).toEqual({
        ffmpeg: null,
        ffprobe: null,
        whisper: bin,
        whisperModel: '/models/base.bin',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

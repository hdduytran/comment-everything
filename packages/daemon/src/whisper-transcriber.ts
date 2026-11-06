import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Transcript } from '@comment-everything/core';
import { runBinary, type MediaTools } from './media-binaries.js';

export interface Segment {
  start: number;
  end: number;
  text: string;
}

/** One entry of whisper.cpp's JSON `transcription` array (fields validated when read). */
interface WhisperItem {
  offsets?: { from?: unknown; to?: unknown };
  timestamps?: { from?: unknown; to?: unknown };
  text?: unknown;
}

/**
 * Parse `whisper-cli -oj` output. Segments carry millisecond `offsets`; the `timestamps`
 * strings (`HH:MM:SS,mmm`) are the fallback for older builds.
 */
export function parseWhisperJson(raw: string): Segment[] {
  const data = JSON.parse(raw) as { transcription?: unknown };
  if (!Array.isArray(data.transcription)) throw new Error('Unexpected whisper output');
  const clock = (s: unknown): number | null => {
    const m = /^(\d+):(\d+):(\d+)[,.](\d+)$/.exec(String(s));
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4]}`) : null;
  };
  const out: Segment[] = [];
  for (const item of data.transcription as WhisperItem[]) {
    const ms = (v: unknown) => (typeof v === 'number' ? v / 1000 : null);
    const start = ms(item.offsets?.from) ?? clock(item.timestamps?.from);
    const end = ms(item.offsets?.to) ?? clock(item.timestamps?.to);
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (start === null || end === null || !text) continue;
    out.push({ start, end, text });
  }
  return out;
}

/** Segments that overlap `[start, end]` (a point matches the segment containing it). */
export function segmentsInRange(segments: Segment[], start: number, end = start): Segment[] {
  return segments.filter((s) => s.end > start && s.start < Math.max(end, start + 1e-3));
}

export function toTranscript(segments: Segment[]): Transcript {
  return { text: segments.map((s) => s.text).join(' '), segments };
}

/** True when both `whisper-cli` and a model file are available. */
export function whisperReady(tools: MediaTools): boolean {
  return Boolean(tools.whisper && tools.whisperModel);
}

async function cacheKey(file: string, model: string): Promise<string> {
  const info = await stat(file);
  return createHash('sha1').update(`${file}|${info.size}|${info.mtimeMs}|${model}`).digest('hex');
}

/**
 * Transcribe the whole file once and cache the segments per file (keyed by path, size, mtime
 * and model), so later comments on the same media reuse the result.
 */
export async function transcribeFile(
  tools: MediaTools,
  file: string,
  cacheDir: string,
): Promise<Segment[]> {
  if (!tools.ffmpeg || !tools.whisper || !tools.whisperModel) {
    throw new Error('whisper transcription is not available');
  }
  await mkdir(cacheDir, { recursive: true });
  const cached = path.join(cacheDir, `${await cacheKey(file, tools.whisperModel)}.transcript.json`);
  try {
    return JSON.parse(await readFile(cached, 'utf8')) as Segment[];
  } catch {
    // not cached yet
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'ce-whisper-'));
  try {
    const wav = path.join(dir, 'audio.wav');
    await runBinary(
      tools.ffmpeg,
      [
        '-v',
        'error',
        '-y',
        '-i',
        file,
        '-vn',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        wav,
      ],
      { timeoutMs: 300_000 },
    );
    const prefix = path.join(dir, 'out');
    await runBinary(tools.whisper, ['-m', tools.whisperModel, '-f', wav, '-oj', '-of', prefix], {
      timeoutMs: 1_800_000,
    });
    const segments = parseWhisperJson(await readFile(`${prefix}.json`, 'utf8'));
    await writeFile(cached, JSON.stringify(segments));
    return segments;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

import path from 'node:path';
import {
  globalDataDir,
  parseMediaFragment,
  type Comment,
  type Transcript,
} from '@comment-everything/core';
import type { SentBatch } from './comment-events-sse.js';
import type { CommentService } from './comment-service.js';
import {
  extractClip,
  extractFrame,
  keyframeTimes,
  timeLabel,
} from './ffmpeg-keyframe-extractor.js';
import type { JobQueue } from './job-queue.js';
import {
  FFMPEG_INSTALL_HINT,
  WHISPER_INSTALL_HINT,
  detectMediaTools,
  type MediaTools,
} from './media-binaries.js';
import { mediaKindOf } from './media-kinds.js';
import type { MediaRouteDeps } from './media-routes.js';
import { resolveScopedPath } from './scoped-file-server.js';
import {
  segmentsInRange,
  toTranscript,
  transcribeFile,
  whisperReady,
} from './whisper-transcriber.js';

export const MEDIA_ENRICH_JOB = 'media.enrich';

export interface MediaOptions {
  /** Tool discovery; defaults to a PATH scan on every call (so installing ffmpeg needs no restart). */
  tools?: () => MediaTools;
  /** Also export each range as an mp4 asset (`-c copy`). Off by default: clips can be large. */
  exportClips?: boolean;
  /** Where thumbnails, scene cuts and transcripts are cached. */
  cacheDir: string;
  warn?: (message: string) => void;
}

export interface EnrichResult {
  assets: string[];
  transcript: boolean;
  /** Reasons a step was skipped (missing tool), also logged once as warnings. */
  skipped: string[];
}

/** The time range a media comment points at, or null for comments without a time fragment. */
export function commentTimeRange(c: Comment): { start: number; end?: number } | null {
  for (const sel of c.selectors) {
    if (sel.type !== 'FragmentSelector') continue;
    const t = parseMediaFragment(sel);
    if (t) return t;
  }
  return null;
}

/** Cache folder under the per-install data dir. */
export const mediaCacheDir = (home: string) => path.join(globalDataDir(home), 'cache');

/**
 * Wire media post-processing: after a Send batch is stored, every comment on a media file gets
 * keyframes (video), an optional clip and a transcript (when whisper is available), patched
 * onto the comment. Returns the dependencies the `/media/*` routes need.
 */
export function setupMedia(
  service: CommentService,
  jobs: JobQueue,
  opts: MediaOptions,
): MediaRouteDeps {
  const tools = opts.tools ?? (() => detectMediaTools());
  const warn = opts.warn ?? ((m: string) => console.warn(`[comment-everything] ${m}`));
  let warnedFfmpeg = false;
  let warnedWhisper = false;

  jobs.register<{ commentId: string }, EnrichResult>(MEDIA_ENRICH_JOB, async ({ commentId }) => {
    const found = await service.get(commentId);
    const range = found && commentTimeRange(found);
    const kind = found && mediaKindOf(found.source);
    const result: EnrichResult = { assets: [], transcript: false, skipped: [] };
    if (!found || !range || !kind) return result;

    const t = tools();
    const file = await resolveScopedPath(found.root, found.source);
    const store = service.registry.storeFor(found.root);
    if (!store) throw new Error(`Root not registered: ${found.root}`);

    if (!t.ffmpeg) {
      result.skipped.push(FFMPEG_INSTALL_HINT);
      if (!warnedFfmpeg) warn(FFMPEG_INSTALL_HINT);
      warnedFfmpeg = true;
    } else if (kind === 'video') {
      for (const at of keyframeTimes(range.start, range.end)) {
        const name = `${commentId}-${timeLabel(at)}.jpg`;
        result.assets.push(await store.writeAsset(name, await extractFrame(t.ffmpeg, file, at)));
      }
      if (opts.exportClips && range.end !== undefined && range.end > range.start) {
        const name = `${commentId}-clip.mp4`;
        const clip = await extractClip(t.ffmpeg, file, range.start, range.end);
        result.assets.push(await store.writeAsset(name, clip));
      }
    }

    let transcript: Transcript | undefined;
    if (whisperReady(t)) {
      try {
        const segments = await transcribeFile(t, file, opts.cacheDir);
        const inRange = segmentsInRange(segments, range.start, range.end);
        if (inRange.length > 0) transcript = toTranscript(inRange);
      } catch (err) {
        // A transcript is optional (e.g. the file has no audio); keyframes must still be saved.
        result.skipped.push(`Transcript skipped: ${(err as Error).message}`);
      }
    } else {
      result.skipped.push(WHISPER_INSTALL_HINT);
      if (!warnedWhisper) warn(WHISPER_INSTALL_HINT);
      warnedWhisper = true;
    }

    // Re-read right before patching so a concurrent edit (resolve, text change) is not clobbered.
    const latest = await service.get(commentId);
    if (latest && (result.assets.length > 0 || transcript)) {
      const assets = [...new Set([...latest.assets, ...result.assets])];
      await service.update(commentId, { assets, ...(transcript ? { transcript } : {}) });
      result.transcript = Boolean(transcript);
    }
    return result;
  });

  service.onBatchCreated = (batch: SentBatch) => {
    for (const c of batch.comments) {
      if (mediaKindOf(c.source) && commentTimeRange(c)) {
        jobs.enqueue(MEDIA_ENRICH_JOB, { commentId: c.id });
      }
    }
  };

  return { registry: service.registry, tools, cacheDir: opts.cacheDir };
}

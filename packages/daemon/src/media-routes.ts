import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Hono } from 'hono';
import { ValidationError } from './comment-service.js';
import { FFMPEG_INSTALL_HINT, WHISPER_INSTALL_HINT, type MediaTools } from './media-binaries.js';
import { mediaKindOf } from './media-kinds.js';
import type { ProjectRootRegistry } from './project-root-registry.js';
import { buildThumbnailSprite, detectSceneCuts } from './scene-cut-detector.js';
import { resolveScopedPath } from './scoped-file-server.js';

export interface MediaRouteDeps {
  registry: ProjectRootRegistry;
  tools: () => MediaTools;
  cacheDir: string;
}

interface SpriteMeta {
  frames: number;
  duration: number;
  thumbWidth: number;
  thumbHeight: number;
}

/** Resolve `?rootId=&path=` to a scoped media file plus a cache key that changes with the file. */
async function resolveMedia(deps: MediaRouteDeps, rootId?: string, rel?: string) {
  const root = rootId ? deps.registry.get(rootId) : undefined;
  if (!root || !rel) throw new ValidationError('rootId and path are required');
  if (!mediaKindOf(rel)) throw new ValidationError('path is not a media file');
  const file = await resolveScopedPath(root.root, rel);
  const info = await stat(file);
  const key = createHash('sha1').update(`${file}|${info.size}|${info.mtimeMs}`).digest('hex');
  return { file, key };
}

/** Run `work` once per key even when several requests arrive together. */
function dedupe<T>(inflight: Map<string, Promise<T>>, key: string, work: () => Promise<T>) {
  const running = inflight.get(key);
  if (running) return running;
  const p = work().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/**
 * `/media/*` helper routes for the media viewer: tool availability, a thumbnail strip (one JPEG,
 * geometry in response headers) and scene-cut suggestions. Results are cached on disk.
 */
export function mountMediaRoutes(app: Hono, deps: MediaRouteDeps): void {
  const sprites = new Map<string, Promise<SpriteMeta>>();
  const scenes = new Map<string, Promise<number[]>>();

  app.get('/media/capabilities', (c) => {
    const t = deps.tools();
    return c.json({
      ffmpeg: Boolean(t.ffmpeg),
      whisper: Boolean(t.whisper && t.whisperModel),
      warnings: [
        ...(t.ffmpeg ? [] : [FFMPEG_INSTALL_HINT]),
        ...(t.whisper && t.whisperModel ? [] : [WHISPER_INSTALL_HINT]),
      ],
    });
  });

  app.get('/media/thumbnails', async (c) => {
    const t = deps.tools();
    if (!t.ffmpeg || !t.ffprobe)
      return c.json({ error: 'ffmpeg_missing', message: FFMPEG_INSTALL_HINT }, 503);
    const { file, key } = await resolveMedia(deps, c.req.query('rootId'), c.req.query('path'));
    const jpg = path.join(deps.cacheDir, `${key}.sprite.jpg`);
    const metaFile = path.join(deps.cacheDir, `${key}.sprite.json`);
    const ffmpeg = t.ffmpeg;
    const ffprobe = t.ffprobe;
    const meta = await dedupe(sprites, key, async () => {
      try {
        return JSON.parse(await readFile(metaFile, 'utf8')) as SpriteMeta;
      } catch {
        // build below
      }
      const sprite = await buildThumbnailSprite(ffmpeg, ffprobe, file);
      await mkdir(deps.cacheDir, { recursive: true });
      await writeFile(jpg, sprite.jpeg);
      const meta: SpriteMeta = {
        frames: sprite.frames,
        duration: sprite.duration,
        thumbWidth: sprite.thumbWidth,
        thumbHeight: sprite.thumbHeight,
      };
      await writeFile(metaFile, JSON.stringify(meta));
      return meta;
    });
    return new Response(new Uint8Array(await readFile(jpg)), {
      headers: {
        'Content-Type': 'image/jpeg',
        'X-CE-Frames': String(meta.frames),
        'X-CE-Duration': String(meta.duration),
        'X-CE-Thumb-Width': String(meta.thumbWidth),
        'X-CE-Thumb-Height': String(meta.thumbHeight),
        'Access-Control-Expose-Headers':
          'X-CE-Frames, X-CE-Duration, X-CE-Thumb-Width, X-CE-Thumb-Height',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  app.get('/media/scenes', async (c) => {
    const t = deps.tools();
    if (!t.ffmpeg) return c.json({ error: 'ffmpeg_missing', message: FFMPEG_INSTALL_HINT }, 503);
    const { file, key } = await resolveMedia(deps, c.req.query('rootId'), c.req.query('path'));
    const ffmpeg = t.ffmpeg;
    const cached = path.join(deps.cacheDir, `${key}.scenes.json`);
    const cuts = await dedupe(scenes, key, async () => {
      try {
        return JSON.parse(await readFile(cached, 'utf8')) as number[];
      } catch {
        // detect below
      }
      const found = await detectSceneCuts(ffmpeg, file);
      await mkdir(deps.cacheDir, { recursive: true });
      await writeFile(cached, JSON.stringify(found));
      return found;
    });
    return c.json({ cuts });
  });
}

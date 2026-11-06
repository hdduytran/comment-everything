import type { Comment, CommentInput, Selector } from '@comment-everything/core/browser';
import type { DaemonTransport } from '@comment-everything/overlay';
import type { AssetStore } from './local-asset-store.js';
import { referencedAssets } from './standalone-export-files.js';

/** Same cap as a daemon batch. */
const CHUNK = 200;

/**
 * Move comments saved in this browser to a daemon project. Screenshots are uploaded first and
 * the comments are rewritten to point at the uploaded copies. Local copies are removed only
 * after the daemon accepted their batch, so a failure never loses a comment and a retry never
 * sends one twice. Resolves to how many comments moved.
 */
export async function migrateLocalComments(opts: {
  comments: readonly Comment[];
  assets: AssetStore;
  daemon: Pick<DaemonTransport, 'sendBatch' | 'uploadAsset'>;
  /** Forget these comments locally (called per accepted batch). */
  forget(comments: readonly Comment[]): Promise<void>;
}): Promise<number> {
  const uploaded = new Map<string, string | null>();
  for (const path of referencedAssets([...opts.comments])) {
    const blob = await opts.assets.get(path).catch(() => null);
    uploaded.set(path, blob ? await opts.daemon.uploadAsset(blob) : null);
  }

  const toInput = (c: Comment): CommentInput => {
    const selectors = c.selectors.flatMap((s): Selector[] => {
      if (s.type !== 'ScreenshotSelector') return [s];
      const asset = uploaded.get(s.asset);
      return asset ? [{ ...s, asset }] : []; // the screenshot is gone: keep the rest of the comment
    });
    const assets = c.assets.flatMap((a) => uploaded.get(a) ?? []);
    return { source: c.source, text: c.text, selectors, assets };
  };

  let moved = 0;
  for (let i = 0; i < opts.comments.length; i += CHUNK) {
    const chunk = opts.comments.slice(i, i + CHUNK);
    await opts.daemon.sendBatch(chunk.map(toInput));
    await opts.forget(chunk);
    moved += chunk.length;
  }
  return moved;
}

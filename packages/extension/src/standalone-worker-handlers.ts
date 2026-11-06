import { CommentSchema } from '@comment-everything/core/browser';
import { base64ToBytes, bytesToBase64 } from './base64-bytes.js';
import type {
  AssetGetReply,
  AssetPutReply,
  ExportReply,
  WorkerRequest,
} from './extension-messages.js';
import type { KeyValueStore } from './key-value-store.js';
import { MAX_ASSET_BYTES, assertAssetPath, type AssetStore } from './local-asset-store.js';
import {
  buildExportFiles,
  displayPath,
  exportFolder,
  exportStamp,
  referencedAssets,
  saveExportFiles,
  type DownloadsApi,
} from './standalone-export-files.js';

/** Where "Open in Claude" goes. Fixed here so no page or message can choose another address. */
export const CLAUDE_NEW_CHAT_URL = 'https://claude.ai/new';
const STAMP_KEY = 'lastExportStamp';
const MAX_EXPORT_COMMENTS = 200;

export interface StandaloneWorkerDeps {
  store: KeyValueStore;
  assets: AssetStore;
  downloads: DownloadsApi;
  openTab(url: string): Promise<unknown>;
  now?: () => Date;
}

/** Two exports in the same minute get `-2`, `-3` ... so their files never mix. */
async function uniqueStamp(store: KeyValueStore, now: Date): Promise<string> {
  const base = exportStamp(now);
  const last = await store.get<{ stamp: string; n: number }>(STAMP_KEY);
  const n = last?.stamp === base ? last.n + 1 : 1;
  await store.set(STAMP_KEY, { stamp: base, n });
  return n === 1 ? base : `${base}-${n}`;
}

async function exportComments(
  req: Extract<WorkerRequest, { type: 'ce:export' }>,
  deps: StandaloneWorkerDeps,
): Promise<ExportReply> {
  const comments = CommentSchema.array().min(1).max(MAX_EXPORT_COMMENTS).parse(req.comments);
  if (typeof req.host !== 'string' || req.host === '') throw new Error('Missing page host');
  const now = deps.now?.() ?? new Date();
  const folder = exportFolder(req.host, await uniqueStamp(deps.store, now));

  const assets = new Map<string, Uint8Array>();
  for (const path of referencedAssets(comments)) {
    assertAssetPath(path);
    const blob = await deps.assets.get(path);
    // A screenshot that was deleted meanwhile must not block the export of the text.
    if (blob) assets.set(path, new Uint8Array(await blob.arrayBuffer()));
  }
  const files = buildExportFiles({ folder, comments, assets, now });
  const saved = await saveExportFiles(deps.downloads, files);
  return { ok: true, where: displayPath(saved), count: comments.length };
}

/**
 * Worker side of standalone mode. Returns `undefined` for requests that belong to daemon mode so
 * the caller can handle them.
 */
export async function handleStandaloneRequest(
  req: WorkerRequest,
  deps: StandaloneWorkerDeps,
): Promise<AssetPutReply | AssetGetReply | ExportReply | { ok: true } | undefined> {
  switch (req.type) {
    case 'ce:asset-put': {
      // base64 is 4/3 the size of the bytes; refuse before decoding.
      if (typeof req.body !== 'string' || req.body.length > (MAX_ASSET_BYTES * 4) / 3 + 4) {
        throw new Error('Screenshot is too large');
      }
      const bytes = base64ToBytes(req.body);
      return { ok: true, path: await deps.assets.put(new Blob([bytes], { type: 'image/png' })) };
    }
    case 'ce:asset-get': {
      assertAssetPath(req.path);
      const blob = await deps.assets.get(req.path);
      return {
        ok: true,
        body: blob ? bytesToBase64(new Uint8Array(await blob.arrayBuffer())) : null,
      };
    }
    case 'ce:asset-delete':
      assertAssetPath(req.path);
      await deps.assets.delete(req.path);
      return { ok: true };
    case 'ce:export':
      return exportComments(req, deps);
    case 'ce:open-claude':
      await deps.openTab(CLAUDE_NEW_CHAT_URL);
      return { ok: true };
    default:
      return undefined;
  }
}

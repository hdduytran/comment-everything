import {
  CommentSchema,
  applyPatch,
  createComment,
  newBatchId,
  type Comment,
  type CommentInput,
  type CommentStatus,
} from '@comment-everything/core/browser';
import type { DaemonEvent, DaemonTransport } from '@comment-everything/overlay';
import type { AssetStore } from './local-asset-store.js';
import type { KeyValueStore } from './key-value-store.js';
import { originOf } from './origin-to-project-mapping.js';

const PREFIX = 'localComments:';
/** Same cap as a daemon batch. */
const MAX_BATCH = 200;

function groupBySource(list: readonly Comment[]): Map<string, Comment[]> {
  const groups = new Map<string, Comment[]>();
  for (const c of list) groups.set(c.source, [...(groups.get(c.source) ?? []), c]);
  return groups;
}

const keyFor = (source: string) => PREFIX + source;

/** Comments saved for one page, dropping entries that fail validation (corrupted or from a newer build). */
async function loadSource(store: KeyValueStore, source: string): Promise<Comment[]> {
  const raw = await store.get<unknown>(keyFor(source));
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = CommentSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

async function saveSource(store: KeyValueStore, source: string, list: Comment[]): Promise<void> {
  if (list.length === 0) await store.remove(keyFor(source));
  else await store.set(keyFor(source), list);
}

/** Every comment saved in this browser, any page. */
export async function listAllLocalComments(store: KeyValueStore): Promise<Comment[]> {
  const keys = (await store.keys()).filter((k) => k.startsWith(PREFIX));
  const lists = await Promise.all(keys.map((k) => loadSource(store, k.slice(PREFIX.length))));
  return lists.flat();
}

/** Unresolved comments saved for pages of `origin`: what "move to project" would send. */
export async function listMigratable(store: KeyValueStore, origin: string): Promise<Comment[]> {
  return (await listAllLocalComments(store)).filter(
    (c) => c.status !== 'resolved' && originOf(c.source) === origin,
  );
}

/** Forget comments by id and release their screenshots. */
export async function removeLocalComments(
  store: KeyValueStore,
  assets: AssetStore,
  comments: readonly Comment[],
): Promise<void> {
  const bySource = groupBySource(comments);
  for (const [source, gone] of bySource) {
    const ids = new Set(gone.map((c) => c.id));
    await saveSource(
      store,
      source,
      (await loadSource(store, source)).filter((c) => !ids.has(c.id)),
    );
  }
  await Promise.all(comments.flatMap((c) => c.assets.map((a) => assets.delete(a).catch(() => {}))));
}

/**
 * A `DaemonTransport` for pages with no daemon: comments live in `chrome.storage.local`, one list
 * per page URL, screenshots in `assets`. Everything is validated with the shared comment schema.
 */
export function createLocalTransport(opts: {
  source: string;
  store: KeyValueStore;
  assets: AssetStore;
  now?: () => Date;
}): DaemonTransport {
  const { source, store, assets } = opts;
  const handlers = new Set<(e: DaemonEvent) => void>();
  const emit = (e: DaemonEvent) => handlers.forEach((h) => h(e));
  // Read-modify-write cycles run one at a time so quick clicks cannot overwrite each other.
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };

  return {
    sendBatch: (inputs: CommentInput[]) =>
      exclusive(async () => {
        if (inputs.length === 0 || inputs.length > MAX_BATCH) {
          throw new Error(`A batch holds 1 to ${MAX_BATCH} comments`);
        }
        const batchId = newBatchId();
        const created = inputs.map((i) => createComment(i, { batchId, now: opts.now?.() }));
        const bySource = groupBySource(created);
        for (const [src, fresh] of bySource) {
          await saveSource(store, src, [...(await loadSource(store, src)), ...fresh]);
        }
        for (const comment of created) emit({ type: 'comment.created', comment });
        return { batchId, comments: created };
      }),

    uploadAsset: (image) => assets.put(image),

    listComments: () => loadSource(store, source),

    updateStatus: (id: string, status: CommentStatus) =>
      exclusive(async () => {
        const list = await loadSource(store, source);
        const at = list.findIndex((c) => c.id === id);
        if (at < 0) throw new Error('Comment not found');
        const updated = applyPatch(list[at]!, { status }, opts.now?.());
        list[at] = updated;
        await saveSource(store, source, list);
        emit({ type: 'comment.updated', comment: updated });
        return updated;
      }),

    deleteComment: (id: string) =>
      exclusive(async () => {
        const gone = (await loadSource(store, source)).find((c) => c.id === id);
        if (!gone) throw new Error('Comment not found');
        await removeLocalComments(store, assets, [gone]);
        emit({ type: 'comment.deleted', id });
      }),

    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CommentInputSchema,
  createComment,
  newBatchId,
  resolveStorageRoot,
  type Comment,
  type CommentPatch,
  type CommentStatus,
  type StorageChange,
} from '@comment-everything/core';
import { z } from 'zod';
import { CommentEventBus, type SentBatch } from './comment-events-sse.js';
import { ProjectRootRegistry, RootRegistryError } from './project-root-registry.js';
import { mimeTypeFor, resolveScopedPath } from './scoped-file-server.js';

/** A comment plus the project root its `source` is relative to. */
export type CommentWithRoot = Comment & { root: string };

export interface ListFilter {
  source?: string;
  status?: CommentStatus;
  root?: string;
}

export interface AssetBlob {
  data: Uint8Array;
  mimeType: string;
}

/**
 * Everything MCP tools and REST routes need. Implemented in-process by
 * `CommentService` and over HTTP by `HttpCommentBackend` (the stdio proxy).
 */
export interface CommentBackend {
  list(filter?: ListFilter): Promise<CommentWithRoot[]>;
  get(id: string): Promise<CommentWithRoot | null>;
  update(id: string, patch: CommentPatch): Promise<CommentWithRoot | null>;
  readAsset(id: string, asset: string): Promise<AssetBlob | null>;
  /** Next unclaimed Send batch, or null after `timeoutSec` seconds / abort. */
  waitForBatch(timeoutSec: number, signal?: AbortSignal): Promise<SentBatch | null>;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export const CreateBatchBodySchema = z.object({
  /** Project root for file sources; ignored for http(s) sources (derived from the host). */
  root: z.string().optional(),
  batchId: z.string().min(1).max(100).optional(),
  comments: z.array(CommentInputSchema).min(1).max(200),
});

const isUrl = (source: string) => /^https?:\/\//i.test(source);

/** A file `source` must be a relative path that stays inside the project. */
function assertRelativeSource(source: string): void {
  const normalized = path.posix.normalize(source.replace(/\\/g, '/'));
  if (path.isAbsolute(source) || normalized.startsWith('../') || normalized === '..') {
    throw new ValidationError(`source must be a relative path inside the project: ${source}`);
  }
}

export class CommentService implements CommentBackend {
  /** Called after a Send batch is stored and published (e.g. to queue media post-processing). */
  onBatchCreated?: (batch: SentBatch) => void;

  constructor(
    readonly registry: ProjectRootRegistry,
    readonly bus: CommentEventBus,
    private readonly home?: string,
  ) {}

  /** Create one batch ("Send"): persist every comment, then publish it to agents and SSE. */
  async createBatch(body: z.input<typeof CreateBatchBodySchema>): Promise<SentBatch> {
    // Validate every comment before writing any, so a bad one never leaves a half-saved batch.
    for (const input of body.comments) {
      CommentInputSchema.parse(input);
      if (!isUrl(input.source)) {
        assertRelativeSource(input.source);
        if (!body.root) throw new ValidationError('root is required for file sources');
      }
    }
    const batchId = body.batchId ?? newBatchId();
    const created: CommentWithRoot[] = [];
    for (const input of body.comments) {
      let root: string;
      if (isUrl(input.source)) {
        root = (await this.registry.registerDataFolder(resolveStorageRoot(input.source, this.home)))
          .root;
      } else {
        const known = await this.registry.register(body.root ?? '').catch((e: unknown) => {
          throw e instanceof RootRegistryError ? new ValidationError(e.message) : e;
        });
        root = known.root;
      }
      const store = this.registry.storeFor(root);
      if (!store) throw new ValidationError(`Root not registered: ${root}`);
      const comment = createComment(input, { batchId });
      await store.write(comment);
      const entry = this.registry.findContaining(root);
      if (entry) this.registry.startWatching(entry.id);
      created.push({ ...comment, root });
    }
    for (const c of created)
      this.bus.publish({ type: 'comment.created', root: c.root, comment: c });
    const batch: SentBatch = { batchId, comments: created };
    this.bus.sendBatch(batch);
    try {
      this.onBatchCreated?.(batch);
    } catch (err) {
      // Post-processing must never fail the Send itself; the comments are already saved.
      console.error('[comment-everything] batch hook failed:', err);
    }
    return batch;
  }

  async list(filter: ListFilter = {}): Promise<CommentWithRoot[]> {
    const roots = this.registry
      .list()
      .filter((r) => filter.root === undefined || r.root === filter.root || r.id === filter.root);
    const lists = await Promise.all(
      roots.map(async (r) => {
        const store = this.registry.storeFor(r.id);
        const comments =
          (await store?.list({ source: filter.source, status: filter.status })) ?? [];
        return comments.map((c) => ({ ...c, root: r.root }));
      }),
    );
    return lists
      .flat()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<CommentWithRoot | null> {
    const found = await this.registry.findComment(id);
    return found ? { ...found.comment, root: found.root } : null;
  }

  async update(id: string, patch: CommentPatch): Promise<CommentWithRoot | null> {
    const found = await this.registry.findComment(id);
    if (!found) return null;
    const next = await found.store.update(id, patch);
    if (!next) return null;
    this.bus.publish({ type: 'comment.updated', root: found.root, comment: next });
    return { ...next, root: found.root };
  }

  /** Read an asset listed on the comment (never an arbitrary path). */
  async readAsset(id: string, asset: string): Promise<AssetBlob | null> {
    const found = await this.registry.findComment(id);
    if (!found || !found.comment.assets.includes(asset)) return null;
    try {
      const file = await resolveScopedPath(found.store.commentsDir, asset);
      return { data: new Uint8Array(await readFile(file)), mimeType: mimeTypeFor(file) };
    } catch {
      return null;
    }
  }

  /**
   * Store an uploaded image under the `.comments/assets/` folder of a project root (`root`)
   * or of the per-host data folder for a web URL (`source`). Returns the relative asset path.
   */
  async saveAsset(
    target: { root?: string; source?: string },
    data: Uint8Array,
    ext: string,
  ): Promise<string> {
    let root: string;
    if (target.source && isUrl(target.source)) {
      root = (await this.registry.registerDataFolder(resolveStorageRoot(target.source, this.home)))
        .root;
    } else if (target.root) {
      root = (
        await this.registry.register(target.root).catch((e: unknown) => {
          throw e instanceof RootRegistryError ? new ValidationError(e.message) : e;
        })
      ).root;
    } else {
      throw new ValidationError('root or an http(s) source is required');
    }
    const store = this.registry.storeFor(root);
    if (!store) throw new ValidationError(`Root not registered: ${root}`);
    return store.writeAsset(`${randomUUID()}.${ext}`, data);
  }

  waitForBatch(timeoutSec: number, signal?: AbortSignal): Promise<SentBatch | null> {
    return this.bus.nextBatch(timeoutSec * 1000, signal);
  }

  /** Forward an on-disk change (edit by another process) to SSE unless we wrote it ourselves. */
  handleStorageChange(root: string, change: StorageChange): void {
    if (change.type === 'unlink') {
      this.bus.publish({ type: 'comment.deleted', root, id: change.id });
    } else if (change.comment && !this.bus.alreadySeen(change.comment)) {
      this.bus.publish({
        type: change.type === 'add' ? 'comment.created' : 'comment.updated',
        root,
        comment: change.comment,
      });
    }
  }
}

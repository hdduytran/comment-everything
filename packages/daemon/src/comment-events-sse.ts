import { EventEmitter } from 'node:events';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Comment } from '@comment-everything/core';
import type { AgentsStatus } from './agent-activity-registry.js';

export type CommentEvent =
  | { type: 'comment.created'; root: string; comment: Comment }
  | { type: 'comment.updated'; root: string; comment: Comment }
  | { type: 'comment.deleted'; root: string; id: string }
  /** A "Send" press: all comments of one batch, delivered to waiting agents. */
  | { type: 'batch.sent'; batchId: string; ids: string[] }
  /** A file opened in the viewer changed on disk; `path` is relative to `root`. */
  | { type: 'file.changed'; root: string; path: string }
  /** An MCP client connected, left, or started/stopped waiting for comments. */
  | { type: 'agents.changed'; status: AgentsStatus };

export interface SentBatch {
  batchId: string;
  comments: (Comment & { root: string })[];
}

const MAX_PENDING_BATCHES = 100;

/**
 * How long after an agent last waited it still counts as "watching". Covers the gap
 * between two `wait_for_comments` calls while the agent works on the previous batch.
 */
export const WATCH_GRACE_MS = 120_000;

/**
 * In-process hub for live updates. Fans comment events out to SSE clients and holds
 * sent-but-unclaimed batches for agents that are watching, so a Send made while the
 * agent is busy with the previous batch is not missed. Batches sent while nobody is
 * watching are not queued: a later watcher must not receive stale work (the comments
 * stay on disk and `list_comments` still returns them).
 */
export class CommentEventBus {
  private readonly emitter = new EventEmitter();
  private readonly pending: SentBatch[] = [];
  private activeWaiters = 0;
  private lastWaitAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly now: () => number = Date.now) {
    this.emitter.setMaxListeners(0);
  }

  /** True while an agent is waiting, or waited within the grace period. */
  isWatching(): boolean {
    return this.activeWaiters > 0 || this.now() - this.lastWaitAt <= WATCH_GRACE_MS;
  }
  /** id -> updatedAt last published, to drop file-watcher echoes of our own writes. */
  private readonly lastSeen = new Map<string, string>();

  subscribe(listener: (e: CommentEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  publish(event: CommentEvent): void {
    if (event.type === 'comment.created' || event.type === 'comment.updated') {
      this.lastSeen.set(event.comment.id, event.comment.updatedAt);
    }
    this.emitter.emit('event', event);
  }

  /** True when this exact version of the comment was already published. */
  alreadySeen(comment: Comment): boolean {
    return this.lastSeen.get(comment.id) === comment.updatedAt;
  }

  /** Queue a batch for agents and notify SSE listeners. */
  sendBatch(batch: SentBatch): void {
    if (this.isWatching()) {
      this.pending.push(batch);
      if (this.pending.length > MAX_PENDING_BATCHES) this.pending.shift();
    }
    this.publish({
      type: 'batch.sent',
      batchId: batch.batchId,
      ids: batch.comments.map((c) => c.id),
    });
    this.emitter.emit('batch');
  }

  /**
   * Resolve with the oldest unclaimed batch, waiting up to `timeoutMs` for one.
   * Resolves null on timeout or abort. A claimed batch is removed from the queue.
   */
  nextBatch(timeoutMs: number, signal?: AbortSignal): Promise<SentBatch | null> {
    // A watcher arriving after the grace period starts fresh: anything queued then is stale.
    if (!this.isWatching()) this.pending.length = 0;
    this.lastWaitAt = this.now();
    const ready = this.pending.shift();
    if (ready) return Promise.resolve(ready);
    this.activeWaiters++;
    return new Promise((resolve) => {
      const finish = (value: SentBatch | null) => {
        this.activeWaiters--;
        this.lastWaitAt = this.now();
        clearTimeout(timer);
        this.emitter.off('batch', onBatch);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      };
      const onBatch = () => {
        const next = this.pending.shift();
        if (next) finish(next); // another waiter may have claimed it first; keep waiting then
      };
      const onAbort = () => finish(null);
      const timer = setTimeout(() => finish(null), timeoutMs);
      this.emitter.on('batch', onBatch);
      if (signal?.aborted) return finish(null);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

/** Mount `GET /events` (Server-Sent Events). Auth is applied by the app-wide guards. */
export function mountEventsRoute(app: Hono, bus: CommentEventBus): void {
  app.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      let id = 0;
      const unsubscribe = bus.subscribe((e) => {
        void stream.writeSSE({ id: String(++id), event: e.type, data: JSON.stringify(e) });
      });
      stream.onAbort(unsubscribe);
      await stream.writeSSE({ event: 'ready', data: '{}' });
      // Keep-alive comment lines stop idle proxies/browsers from dropping the stream.
      while (!stream.aborted && !stream.closed) {
        await stream.sleep(15_000);
        if (!stream.aborted) await stream.write(': keep-alive\n\n');
      }
      unsubscribe();
    }),
  );
}

import { EventEmitter } from 'node:events';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Comment } from '@comment-everything/core';

export type CommentEvent =
  | { type: 'comment.created'; root: string; comment: Comment }
  | { type: 'comment.updated'; root: string; comment: Comment }
  | { type: 'comment.deleted'; root: string; id: string }
  /** A "Send" press: all comments of one batch, delivered to waiting agents. */
  | { type: 'batch.sent'; batchId: string; ids: string[] }
  /** A file opened in the viewer changed on disk; `path` is relative to `root`. */
  | { type: 'file.changed'; root: string; path: string };

export interface SentBatch {
  batchId: string;
  comments: (Comment & { root: string })[];
}

const MAX_PENDING_BATCHES = 100;

/**
 * In-process hub for live updates. Fans comment events out to SSE clients and holds
 * sent-but-unclaimed batches so `wait_for_comments` never misses a Send that happened
 * while no agent was waiting.
 */
export class CommentEventBus {
  private readonly emitter = new EventEmitter();
  private readonly pending: SentBatch[] = [];
  /** id -> updatedAt last published, to drop file-watcher echoes of our own writes. */
  private readonly lastSeen = new Map<string, string>();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

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
    this.pending.push(batch);
    if (this.pending.length > MAX_PENDING_BATCHES) this.pending.shift();
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
    const ready = this.pending.shift();
    if (ready) return Promise.resolve(ready);
    return new Promise((resolve) => {
      const finish = (value: SentBatch | null) => {
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

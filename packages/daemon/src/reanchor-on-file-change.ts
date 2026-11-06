import { readFile, stat } from 'node:fs/promises';
import { reanchorComment } from '@comment-everything/core';
import type { CommentEventBus } from './comment-events-sse.js';
import type { CommentService } from './comment-service.js';
import { resolveScopedPath } from './scoped-file-server.js';

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

/**
 * Keeps comment anchors in step with their source files. When a watched file changes, every
 * unresolved comment on it is re-anchored against the new text (fuzzy quote + line remap) and
 * patched with its new line range / `anchorState`. The previous text is remembered per file so
 * comments that only carry a line range can still be followed.
 */
export class ReanchorOnFileChange {
  private readonly snapshots = new Map<string, string>();
  /** Runs one file at a time so overlapping change events cannot interleave patches. */
  private readonly queues = new Map<string, Promise<void>>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly service: CommentService,
    private readonly bus: CommentEventBus,
    private readonly onError: (err: unknown) => void = () => undefined,
  ) {}

  start(): void {
    this.unsubscribe ??= this.bus.subscribe((e) => {
      if (e.type === 'file.changed') this.enqueue(e.root, e.path);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Remember the file as it is now (first call per file wins) so the next edit has a "before". */
  async prime(root: string, source: string): Promise<void> {
    const key = `${root}\0${source}`;
    if (this.snapshots.has(key)) return;
    const text = await this.readSource(root, source);
    if (text !== null && !this.snapshots.has(key)) this.snapshots.set(key, text);
  }

  /** Resolves once all queued re-anchoring work has finished (tests). */
  async idle(): Promise<void> {
    while (this.queues.size > 0) await Promise.all([...this.queues.values()]);
  }

  private enqueue(root: string, source: string): void {
    const key = `${root}\0${source}`;
    const run = (this.queues.get(key) ?? Promise.resolve())
      .then(() => this.process(root, source, key))
      .catch(this.onError)
      .finally(() => {
        if (this.queues.get(key) === run) this.queues.delete(key);
      });
    this.queues.set(key, run);
  }

  private async readSource(root: string, source: string): Promise<string | null> {
    try {
      const file = await resolveScopedPath(root, source);
      if ((await stat(file)).size > MAX_SOURCE_BYTES) return null;
      return await readFile(file, 'utf8');
    } catch {
      return null; // deleted or replaced mid-write: the next change event retries
    }
  }

  private async process(root: string, source: string, key: string): Promise<void> {
    const text = await this.readSource(root, source);
    if (text === null) return;
    const previous = this.snapshots.get(key);
    this.snapshots.set(key, text);
    if (text === previous) return;
    const comments = await this.service.list({ root, source });
    for (const c of comments) {
      if (c.status === 'resolved') continue;
      const patch = reanchorComment(c, text, previous);
      if (patch) await this.service.update(c.id, patch);
    }
  }
}

import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import type { CommentEventBus } from './comment-events-sse.js';

const MAX_WATCHED_FILES = 200;

/**
 * Watches files opened in the viewer and publishes `file.changed` so open viewers reload
 * after an edit (including edits by an AI agent). The parent directory is watched, not the
 * file, so editors that replace the file atomically (rename over) are still noticed.
 */
export class FileChangeWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly bus: CommentEventBus,
    private readonly debounceMs = 100,
  ) {}

  /** Start watching `<root>/<relPath>` (idempotent). */
  watch(root: string, relPath: string): void {
    const file = path.join(root, relPath);
    if (this.watchers.has(file) || this.watchers.size >= MAX_WATCHED_FILES) return;
    const dir = path.dirname(file);
    const base = path.basename(file);
    try {
      const w = watch(dir, { persistent: false }, (_event, name) => {
        if (name !== null && name.toString() !== base) return;
        this.schedule(file, root, relPath);
      });
      w.on('error', () => this.unwatch(file));
      this.watchers.set(file, w);
    } catch {
      // Directory vanished or fs.watch is unsupported here: the viewer just loses auto-reload.
    }
  }

  private schedule(file: string, root: string, relPath: string): void {
    clearTimeout(this.timers.get(file));
    this.timers.set(
      file,
      setTimeout(() => {
        this.timers.delete(file);
        this.bus.publish({ type: 'file.changed', root, path: relPath });
      }, this.debounceMs),
    );
  }

  private unwatch(file: string): void {
    this.watchers.get(file)?.close();
    this.watchers.delete(file);
  }

  close(): void {
    for (const file of [...this.watchers.keys()]) this.unwatch(file);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

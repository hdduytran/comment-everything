import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';
import {
  COMMENT_ID_PATTERN,
  applyPatch,
  parseComment,
  type Comment,
  type CommentPatch,
  type CommentStatus,
} from './comment-schema.js';
import { COMMENTS_DIR_NAME } from './project-root-resolver.js';

export type StorageChange = { type: 'add' | 'change' | 'unlink'; id: string; comment?: Comment };

export interface ListFilter {
  source?: string;
  status?: CommentStatus;
}

/**
 * Write `data` to `file` atomically: write a uniquely named temp file in the same
 * directory, then rename over the target (rename is atomic on one filesystem).
 */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** One-JSON-per-comment store rooted at `<root>/.comments/`. */
export class CommentStore {
  readonly root: string;
  readonly commentsDir: string;
  readonly assetsDir: string;
  /** Serializes read-modify-write cycles per id within this process. */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(root: string) {
    this.root = path.resolve(root);
    this.commentsDir = path.join(this.root, COMMENTS_DIR_NAME);
    this.assetsDir = path.join(this.commentsDir, 'assets');
  }

  private fileFor(id: string): string {
    if (!COMMENT_ID_PATTERN.test(id)) throw new Error(`Invalid comment id: ${id}`);
    return path.join(this.commentsDir, `${id}.json`);
  }

  /** Run `fn` after any pending operation on the same id finished. */
  private serialize<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.locks.set(id, tail);
    void tail.then(() => {
      if (this.locks.get(id) === tail) this.locks.delete(id);
    });
    return next;
  }

  async write(comment: Comment): Promise<void> {
    const validated = parseComment(comment);
    await mkdir(this.assetsDir, { recursive: true });
    await this.serialize(validated.id, () =>
      writeFileAtomic(this.fileFor(validated.id), JSON.stringify(validated, null, 2) + '\n'),
    );
  }

  /** Returns null when the comment does not exist. Throws on corrupt/unsupported files. */
  async read(id: string): Promise<Comment | null> {
    let raw: string;
    try {
      raw = await readFile(this.fileFor(id), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    return parseComment(JSON.parse(raw));
  }

  /** Read-modify-write, serialized per id so concurrent patches never lose updates. */
  async update(id: string, patch: CommentPatch): Promise<Comment | null> {
    return this.serialize(id, async () => {
      const current = await this.read(id);
      if (!current) return null;
      const next = applyPatch(current, patch);
      await writeFileAtomic(this.fileFor(id), JSON.stringify(next, null, 2) + '\n');
      return next;
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.serialize(id, async () => {
      const file = this.fileFor(id);
      const existed = (await this.read(id)) !== null;
      await rm(file, { force: true });
      return existed;
    });
  }

  /** Lists comments oldest-first. Unreadable files are skipped and reported via `onSkip`. */
  async list(filter: ListFilter = {}, onSkip?: (file: string, err: unknown) => void): Promise<Comment[]> {
    let names: string[];
    try {
      names = await readdir(this.commentsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const out: Comment[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const c = parseComment(JSON.parse(await readFile(path.join(this.commentsDir, name), 'utf8')));
        if (filter.source !== undefined && c.source !== filter.source) continue;
        if (filter.status !== undefined && c.status !== filter.status) continue;
        out.push(c);
      } catch (err) {
        onSkip?.(name, err);
      }
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  /** Save an asset (keyframe/screenshot) and return its path relative to `.comments/`. */
  async writeAsset(name: string, data: Uint8Array): Promise<string> {
    if (path.basename(name) !== name || name.startsWith('.')) throw new Error(`Invalid asset name: ${name}`);
    await mkdir(this.assetsDir, { recursive: true });
    await writeFileAtomic(path.join(this.assetsDir, name), data);
    return `assets/${name}`;
  }

  /**
   * Watch the comments directory and emit `change` events as files change on disk
   * (including edits made by other processes). Call the returned function to stop.
   */
  watch(emitter: EventEmitter | ((c: StorageChange) => void)): () => Promise<void> {
    const emit = typeof emitter === 'function' ? emitter : (c: StorageChange) => emitter.emit('change', c);
    const watcher = chokidar.watch(this.commentsDir, {
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
    });
    const handle = (type: StorageChange['type']) => async (file: string) => {
      const base = path.basename(file);
      if (!base.endsWith('.json')) return;
      const id = base.slice(0, -'.json'.length);
      if (!COMMENT_ID_PATTERN.test(id)) return;
      if (type === 'unlink') return emit({ type, id });
      try {
        const comment = await this.read(id);
        if (comment) emit({ type, id, comment });
      } catch {
        // half-written or corrupt file: the next change event will retry
      }
    };
    watcher.on('add', handle('add')).on('change', handle('change')).on('unlink', handle('unlink'));
    return () => watcher.close();
  }
}

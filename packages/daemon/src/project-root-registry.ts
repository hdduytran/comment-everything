import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  CommentStore,
  globalDataDir,
  writeFileAtomic,
  type Comment,
  type StorageChange,
} from '@comment-everything/core';
import { resolveHome } from './daemon-lockfile.js';

export interface RegisteredRoot {
  /** Short stable id used in `/files/:rootId/...` URLs. */
  id: string;
  /** Canonical (realpath) absolute directory. */
  root: string;
}

export class RootRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RootRegistryError';
  }
}

export function rootIdFor(canonicalRoot: string): string {
  return createHash('sha256').update(canonicalRoot).digest('hex').slice(0, 12);
}

/**
 * The set of project roots the daemon may read from and serve files out of.
 * Persisted to `<home>/.comment-everything/roots.json` so MCP can list comments
 * for previously opened projects after a daemon restart.
 */
export class ProjectRootRegistry {
  private readonly byId = new Map<string, RegisteredRoot & { store: CommentStore }>();
  private readonly stoppers = new Map<string, () => Promise<void>>();
  private readonly registryFile: string;
  private readonly home: string;

  constructor(
    opts: { home?: string; onStorageChange?: (root: string, change: StorageChange) => void } = {},
  ) {
    this.home = resolveHome(opts.home);
    this.registryFile = path.join(globalDataDir(this.home), 'roots.json');
    this.onStorageChange = opts.onStorageChange;
  }

  private readonly onStorageChange?: (root: string, change: StorageChange) => void;

  /** Load persisted roots, silently dropping ones that no longer exist. */
  async load(): Promise<void> {
    let saved: string[] = [];
    try {
      saved = JSON.parse(await readFile(this.registryFile, 'utf8')) as string[];
    } catch {
      return;
    }
    for (const r of saved) {
      try {
        await this.register(r, { persist: false });
      } catch {
        // directory vanished or is no longer allowed
      }
    }
  }

  /**
   * Register a directory. Rejects relative paths, non-directories, the filesystem root
   * and the user's home folder (too broad to serve files from).
   */
  async register(dir: string, opts: { persist?: boolean } = {}): Promise<RegisteredRoot> {
    if (!path.isAbsolute(dir)) throw new RootRegistryError('Root must be an absolute path');
    let canonical: string;
    try {
      canonical = await realpath(dir);
      if (!(await stat(canonical)).isDirectory()) throw new Error('not a directory');
    } catch {
      throw new RootRegistryError(`Root is not an existing directory: ${dir}`);
    }
    if (
      canonical === path.parse(canonical).root ||
      canonical === (await realpath(this.home).catch(() => this.home))
    ) {
      throw new RootRegistryError('Root is too broad (filesystem root or home directory)');
    }
    const id = rootIdFor(canonical);
    const existing = this.byId.get(id);
    if (existing) return { id, root: existing.root };

    const store = new CommentStore(canonical);
    this.byId.set(id, { id, root: canonical, store });
    this.startWatching(id);
    if (opts.persist !== false) await this.persist();
    return { id, root: canonical };
  }

  /** Register the per-host folder for a web URL source, creating it if needed. */
  async registerDataFolder(dir: string): Promise<RegisteredRoot> {
    await mkdir(dir, { recursive: true });
    // Data folders live inside the home dir, which is intentionally not a valid root itself.
    return this.register(dir);
  }

  /**
   * Watch `.comments/` for edits made by other processes. Only possible once the
   * directory exists, so this is retried after the first write into a root.
   */
  startWatching(id: string): void {
    const entry = this.byId.get(id);
    const cb = this.onStorageChange;
    if (!entry || !cb || this.stoppers.has(id) || !existsSync(entry.store.commentsDir)) return;
    this.stoppers.set(
      id,
      entry.store.watch((c) => cb(entry.root, c)),
    );
  }

  list(): RegisteredRoot[] {
    return [...this.byId.values()].map(({ id, root }) => ({ id, root }));
  }

  get(id: string): RegisteredRoot | undefined {
    const r = this.byId.get(id);
    return r && { id: r.id, root: r.root };
  }

  /** Find the registered root that contains `absPath` (longest match wins). */
  findContaining(absPath: string): RegisteredRoot | undefined {
    let best: RegisteredRoot | undefined;
    for (const r of this.byId.values()) {
      const rel = path.relative(r.root, absPath);
      if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
        if (!best || r.root.length > best.root.length) best = { id: r.id, root: r.root };
      }
    }
    return best;
  }

  storeFor(rootOrId: string): CommentStore | undefined {
    const byId = this.byId.get(rootOrId);
    if (byId) return byId.store;
    return [...this.byId.values()].find((r) => r.root === rootOrId)?.store;
  }

  /** Locate which root holds a comment id. */
  async findComment(
    id: string,
  ): Promise<{ root: string; store: CommentStore; comment: Comment } | null> {
    for (const r of this.byId.values()) {
      const comment = await r.store.read(id).catch(() => null);
      if (comment) return { root: r.root, store: r.store, comment };
    }
    return null;
  }

  async close(): Promise<void> {
    await Promise.all([...this.stoppers.values()].map((stop) => stop()));
    this.stoppers.clear();
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.registryFile), { recursive: true });
    await writeFileAtomic(
      this.registryFile,
      JSON.stringify(
        this.list().map((r) => r.root),
        null,
        2,
      ) + '\n',
    );
  }
}

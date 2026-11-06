import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const COMMENTS_DIR_NAME = '.comments';
export const GLOBAL_DIR_NAME = '.comment-everything';

/** Where global state (lockfile, token, web-page comments) lives. */
export function globalDataDir(home: string = homedir()): string {
  return path.join(home, GLOBAL_DIR_NAME);
}

/**
 * Walk up from `start` to the nearest directory containing `.git` or `.comments`.
 * Returns null when none is found before the filesystem root.
 */
export function findProjectRoot(start: string): string | null {
  let dir = path.resolve(start);
  try {
    if (statSync(dir).isFile()) dir = path.dirname(dir);
  } catch {
    dir = path.dirname(dir); // a not-yet-existing file: start from its folder
  }
  for (;;) {
    if (existsSync(path.join(dir, '.git')) || existsSync(path.join(dir, COMMENTS_DIR_NAME))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Make a URL host safe to use as a directory name (`localhost:3000` -> `localhost_3000`). */
function hostDirName(host: string): string {
  return host.toLowerCase().replace(/[^a-z0-9.-]/g, '_') || 'unknown-host';
}

/**
 * Resolve the storage root for a comment source.
 * - http(s) URL -> `<home>/.comment-everything/<host>/`
 * - file path   -> nearest project root, falling back to the file's own folder
 */
export function resolveStorageRoot(source: string, home: string = homedir()): string {
  if (/^https?:\/\//i.test(source)) {
    return path.join(globalDataDir(home), hostDirName(new URL(source).host));
  }
  return findProjectRoot(source) ?? path.dirname(path.resolve(source));
}

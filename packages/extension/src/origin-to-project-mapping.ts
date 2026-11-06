import type { KeyValueStore } from './key-value-store.js';

const MAPPING_KEY = 'originRoots';

/** Stored value meaning "no project": comments go to the daemon's per-host global folder. */
export const GLOBAL_FOLDER = '';

/** The origin (scheme://host:port) of an http(s) page, or null for pages we cannot comment on. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** The comment `source` for a page: its URL without the fragment. */
export function pageSource(url: string): string {
  const u = new URL(url);
  u.hash = '';
  return u.href;
}

type Mapping = Record<string, string>;

async function load(store: KeyValueStore): Promise<Mapping> {
  const saved = await store.get<Mapping>(MAPPING_KEY);
  return saved && typeof saved === 'object' ? saved : {};
}

/** The project root chosen for `origin`; `GLOBAL_FOLDER` when the user opted out; undefined if unset. */
export async function getMappedRoot(
  store: KeyValueStore,
  origin: string,
): Promise<string | undefined> {
  const value = (await load(store))[origin];
  return typeof value === 'string' ? value : undefined;
}

export async function setMappedRoot(
  store: KeyValueStore,
  origin: string,
  root: string,
): Promise<void> {
  if (!originOf(origin) || originOf(origin) !== origin)
    throw new Error(`Invalid origin: ${origin}`);
  if (root !== GLOBAL_FOLDER && !root.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(root)) {
    throw new Error('Project root must be an absolute path');
  }
  await store.set(MAPPING_KEY, { ...(await load(store)), [origin]: root });
}

export async function clearMappedRoot(store: KeyValueStore, origin: string): Promise<void> {
  const mapping = await load(store);
  delete mapping[origin];
  await store.set(MAPPING_KEY, mapping);
}

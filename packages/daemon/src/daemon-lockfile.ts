import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { globalDataDir, writeFileAtomic } from '@comment-everything/core';

export const DEFAULT_PORT = 4317;
export const DAEMON_HOST = '127.0.0.1';

export interface DaemonLock {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
}

/** Resolve the data dir, honouring `COMMENT_EVERYTHING_HOME` (used by tests and sandboxes). */
export function resolveHome(home?: string): string {
  return home ?? process.env.COMMENT_EVERYTHING_HOME ?? homedir();
}

export function lockfilePath(home?: string): string {
  return path.join(globalDataDir(resolveHome(home)), 'daemon.json');
}

function tokenPath(home?: string): string {
  return path.join(globalDataDir(resolveHome(home)), 'token');
}

/** True when a process with this pid exists (EPERM still means "exists"). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Read and validate the lockfile; returns null when missing or malformed. */
export async function readLock(home?: string): Promise<DaemonLock | null> {
  try {
    const raw = JSON.parse(await readFile(lockfilePath(home), 'utf8')) as Partial<DaemonLock>;
    if (
      typeof raw.pid === 'number' &&
      typeof raw.port === 'number' &&
      typeof raw.token === 'string' &&
      typeof raw.startedAt === 'string'
    ) {
      return raw as DaemonLock;
    }
    return null;
  } catch {
    return null;
  }
}

/** The lock of a live daemon (pid alive and answering /health), else null. */
export async function readLiveLock(home?: string): Promise<DaemonLock | null> {
  const lock = await readLock(home);
  if (!lock || !isProcessAlive(lock.pid)) return null;
  try {
    const res = await fetch(`http://${DAEMON_HOST}:${lock.port}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok ? lock : null;
  } catch {
    return null;
  }
}

/**
 * The per-install token: created once with mode 0600 and reused by every daemon run,
 * so paired clients (extension) keep working across restarts.
 */
export async function loadOrCreateToken(home?: string): Promise<string> {
  const file = tokenPath(home);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    const existing = (await readFile(file, 'utf8')).trim();
    if (existing.length >= 32) return existing;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const token = randomBytes(32).toString('base64url');
  await writeFileAtomic(file, token + '\n');
  await chmod(file, 0o600);
  return token;
}

/**
 * Claim the lockfile. Fails with `{ ok: false, existing }` when a live daemon already
 * holds it; a stale lock (dead pid or unresponsive) is replaced.
 */
export async function acquireLock(
  lock: DaemonLock,
  home?: string,
): Promise<{ ok: true } | { ok: false; existing: DaemonLock }> {
  const file = lockfilePath(home);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(file, JSON.stringify(lock, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      return { ok: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const live = await readLiveLock(home);
      if (live) return { ok: false, existing: live };
      await rm(file, { force: true }); // stale: previous daemon crashed
    }
  }
  throw new Error(`Could not acquire lockfile ${file}`);
}

/** Remove the lockfile, but only if it still belongs to `pid`. */
export async function releaseLock(pid: number, home?: string): Promise<void> {
  const current = await readLock(home);
  if (current?.pid === pid) await rm(lockfilePath(home), { force: true });
}

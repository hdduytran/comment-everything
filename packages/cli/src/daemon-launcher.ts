import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DAEMON_HOST, readLiveLock, type DaemonLock } from '@comment-everything/daemon';

export interface RunningDaemonInfo extends DaemonLock {
  url: string;
}

const toInfo = (lock: DaemonLock): RunningDaemonInfo => ({
  ...lock,
  url: `http://${DAEMON_HOST}:${lock.port}`,
});

/**
 * Return the live daemon, starting a detached `serve` process when none is running.
 * The daemon is a shared per-machine service, so it deliberately outlives this command.
 */
export async function ensureDaemon(opts: { port?: number } = {}): Promise<RunningDaemonInfo> {
  const live = await readLiveLock();
  if (live) return toInfo(live);

  const args = [fileURLToPath(import.meta.url), 'serve'];
  if (opts.port !== undefined) args.push('--port', String(opts.port));
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.on('error', () => undefined); // surfaced below as a start-up timeout
  child.unref();

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const lock = await readLiveLock();
    if (lock) return toInfo(lock);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    'The comment-everything daemon did not start within 10s. Run `comment-everything serve` to see the error.',
  );
}

/** Authenticated JSON request to the daemon. Throws with the daemon's message on non-2xx. */
export async function daemonRequest<T>(
  daemon: RunningDaemonInfo,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(daemon.url + path, {
    method: init.method ?? 'GET',
    headers: { 'x-ce-token': daemon.token, 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!res.ok) throw new Error(data.message ?? data.error ?? `Daemon responded ${res.status}`);
  return data as T;
}

import { serve, type ServerType } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { createApp } from './http-server.js';
import { CommentEventBus } from './comment-events-sse.js';
import { CommentService } from './comment-service.js';
import {
  DAEMON_HOST,
  DEFAULT_PORT,
  acquireLock,
  loadOrCreateToken,
  releaseLock,
  resolveHome,
  type DaemonLock,
} from './daemon-lockfile.js';
import { FileChangeWatcher } from './file-change-watcher.js';
import { JobQueue } from './job-queue.js';
import { MCP_SERVER_VERSION } from './mcp-server-tools.js';
import { PairedExtensionStore } from './paired-extension-store.js';
import { ProjectRootRegistry } from './project-root-registry.js';
import { defaultViewerDir } from './viewer-assets-route.js';

export interface StartDaemonOptions {
  /** Defaults to 4317. Use 0 only in tests; the daemon never auto-increments on conflict. */
  port?: number;
  /** Overrides `~` for the lockfile, token and web-comment storage. */
  home?: string;
  /** Watch `.comments/` for edits by other processes (default true). */
  watch?: boolean;
  sandboxHtml?: boolean;
  /** Built viewer bundle directory (default: auto-detected next to the CLI or in the monorepo). */
  viewerDir?: string;
  /** Write/replace the lockfile (default true). */
  useLockfile?: boolean;
}

export interface RunningDaemon {
  port: number;
  token: string;
  url: string;
  registry: ProjectRootRegistry;
  service: CommentService;
  jobs: JobQueue;
  pairedExtensions: PairedExtensionStore;
  stop(): Promise<void>;
}

export class DaemonAlreadyRunningError extends Error {
  constructor(readonly existing: DaemonLock) {
    super(
      `comment-everything daemon already running on port ${existing.port} (pid ${existing.pid})`,
    );
    this.name = 'DaemonAlreadyRunningError';
  }
}

/**
 * Start the daemon on 127.0.0.1. Throws `DaemonAlreadyRunningError` when a live daemon
 * owns the lockfile, and an `EADDRINUSE` error when the port is taken by something else —
 * the port is never changed automatically.
 */
export async function startDaemon(opts: StartDaemonOptions = {}): Promise<RunningDaemon> {
  const home = resolveHome(opts.home);
  const token = await loadOrCreateToken(home);
  const bus = new CommentEventBus();
  const jobs = new JobQueue();
  // `service` and `registry` reference each other: the registry reports disk changes to the service.
  const wiring: { service?: CommentService } = {};
  const registry = new ProjectRootRegistry({
    home,
    onStorageChange:
      opts.watch === false
        ? undefined
        : (root, change) => wiring.service?.handleStorageChange(root, change),
  });
  const service = new CommentService(registry, bus, home);
  wiring.service = service;
  await registry.load();

  const pairedExtensions = new PairedExtensionStore(home);
  await pairedExtensions.load();
  const fileWatcher = new FileChangeWatcher(bus);
  let port = 0;
  const app = createApp({
    token,
    getPort: () => port,
    service,
    registry,
    bus,
    jobs,
    version: MCP_SERVER_VERSION,
    sandboxHtml: opts.sandboxHtml,
    viewerDir: opts.viewerDir ?? defaultViewerDir(),
    fileWatcher,
    pairedExtensions,
  });

  const server = await listen(app.fetch, opts.port ?? DEFAULT_PORT);
  port = (server.address() as AddressInfo).port;

  const useLock = opts.useLockfile !== false;
  if (useLock) {
    const lock: DaemonLock = { pid: process.pid, port, token, startedAt: new Date().toISOString() };
    const result = await acquireLock(lock, home);
    if (!result.ok) {
      await closeServer(server);
      fileWatcher.close();
      await registry.close();
      throw new DaemonAlreadyRunningError(result.existing);
    }
  }

  return {
    port,
    token,
    url: `http://${DAEMON_HOST}:${port}`,
    registry,
    service,
    jobs,
    pairedExtensions,
    async stop() {
      if (useLock) await releaseLock(process.pid, home);
      fileWatcher.close();
      await registry.close();
      await closeServer(server);
    },
  };
}

function listen(
  fetch: (req: Request) => Response | Promise<Response>,
  port: number,
): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch, port, hostname: DAEMON_HOST }, () => {
      server.off('error', reject);
      resolve(server);
    });
    server.once('error', reject);
  });
}

function closeServer(server: ServerType): Promise<void> {
  return new Promise((resolve) => {
    // Drop lingering keep-alive/SSE sockets so close() can finish.
    (server as { closeAllConnections?: () => void }).closeAllConnections?.();
    server.close(() => resolve());
  });
}

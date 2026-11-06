import { DEFAULT_PORT, DaemonAlreadyRunningError, startDaemon } from '@comment-everything/daemon';
import { CONNECT_HINT } from './connect-hint.js';

/** Run the daemon in the foreground until SIGINT/SIGTERM. Returns the process exit code. */
export async function serveCommand(opts: { port?: number }): Promise<number> {
  try {
    const daemon = await startDaemon({ port: opts.port ?? DEFAULT_PORT });
    console.error(`comment-everything daemon listening on ${daemon.url} (pid ${process.pid})`);
    if (!daemon.agents.status().everConnected) console.error(CONNECT_HINT);
    await new Promise<void>((resolve) => {
      const shutdown = () => {
        void daemon.stop().finally(resolve);
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });
    return 0;
  } catch (err) {
    if (err instanceof DaemonAlreadyRunningError) {
      console.error(`${err.message}; reusing it.`);
      return 0;
    }
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(
        `Port ${opts.port ?? DEFAULT_PORT} is already in use by another program. ` +
          'Stop it or pass --port <n> (clients read the port from ~/.comment-everything/daemon.json).',
      );
      return 1;
    }
    throw err;
  }
}

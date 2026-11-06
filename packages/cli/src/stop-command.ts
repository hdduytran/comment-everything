import { isProcessAlive, readLiveLock } from '@comment-everything/daemon';

const STOP_TIMEOUT_MS = 5_000;

/**
 * Stop the shared daemon: SIGTERM the pid in the lockfile, but only when that daemon is
 * confirmed live (pid alive and answering /health) so a recycled pid is never signalled.
 * Returns the process exit code.
 */
export async function stopCommand(home?: string): Promise<number> {
  const lock = await readLiveLock(home);
  if (!lock) {
    console.log('comment-everything daemon is not running.');
    return 0;
  }
  process.kill(lock.pid, 'SIGTERM');
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isProcessAlive(lock.pid)) {
      console.log(`Stopped comment-everything daemon (pid ${lock.pid}).`);
      return 0;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.error(`Daemon (pid ${lock.pid}) did not exit within 5s after SIGTERM.`);
  return 1;
}

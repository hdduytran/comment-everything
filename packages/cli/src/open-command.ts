import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { findProjectRoot } from '@comment-everything/core';
import { daemonRequest, ensureDaemon } from './daemon-launcher.js';

/** Launch the platform's default browser for `url` without waiting for it. */
function openInBrowser(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () =>
    console.error(`Could not launch a browser; open this URL manually:\n${url}`),
  );
  child.unref();
}

/**
 * Register the file's project root with the daemon (starting it if needed), then print and
 * open the viewer URL. Returns the URL for callers and tests.
 */
export async function openCommand(
  file: string,
  opts: { port?: number; noOpen?: boolean },
): Promise<{ url: string; root: string }> {
  const abs = path.resolve(file);
  try {
    if (!(await stat(abs)).isFile()) throw new Error('not a file');
  } catch {
    throw new Error(`File not found: ${abs}`);
  }
  const real = await realpath(abs);
  const root = findProjectRoot(real) ?? path.dirname(real);

  const daemon = await ensureDaemon(opts);
  await daemonRequest(daemon, '/roots', { method: 'POST', body: { root } }).catch(
    (err: unknown) => {
      throw new Error(
        `${(err as Error).message}. Open the file from inside a project folder (one containing .git or .comments).`,
      );
    },
  );

  const url = `${daemon.url}/view?path=${encodeURIComponent(real)}`;
  console.log(url);
  if (!opts.noOpen) openInBrowser(url);
  return { url, root };
}

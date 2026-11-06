import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { writeFileAtomic } from '@comment-everything/core';

export const MCP_SERVER_KEY = 'comment-everything';
export const MCP_SERVER_ENTRY = { command: 'npx', args: ['-y', 'comment-everything', 'mcp'] };

/** Location of `claude_desktop_config.json` for the given platform. */
export function desktopConfigPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  switch (platform) {
    case 'darwin':
      return path.join(
        home,
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json',
      );
    case 'win32':
      return path.join(
        env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
        'Claude',
        'claude_desktop_config.json',
      );
    default:
      return path.join(
        env.XDG_CONFIG_HOME ?? path.join(home, '.config'),
        'Claude',
        'claude_desktop_config.json',
      );
  }
}

export interface DesktopMergeResult {
  file: string;
  /** Path of the pre-merge copy; null when the config did not exist yet. */
  backup: string | null;
  /** False when the server entry was already present and identical. */
  changed: boolean;
}

/**
 * Add the comment-everything server to a Claude Desktop config without touching anything
 * else. The existing file is copied to `<file>.bak-<timestamp>` first; a config that is not
 * a JSON object is left untouched and reported as an error.
 */
export async function mergeDesktopConfig(
  file: string,
  now = new Date(),
): Promise<DesktopMergeResult> {
  let config: Record<string, unknown> = {};
  let existed = true;
  try {
    const raw = await readFile(file, 'utf8');
    if (raw.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`${file} is not valid JSON; fix it by hand, nothing was changed.`);
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`${file} is not a JSON object; nothing was changed.`);
      }
      config = parsed as Record<string, unknown>;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    existed = false;
  }

  const servers = config.mcpServers ?? {};
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) {
    throw new Error(`"mcpServers" in ${file} is not an object; nothing was changed.`);
  }
  const current = (servers as Record<string, unknown>)[MCP_SERVER_KEY];
  if (JSON.stringify(current) === JSON.stringify(MCP_SERVER_ENTRY)) {
    return { file, backup: null, changed: false };
  }

  let backup: string | null = null;
  if (existed) {
    backup = `${file}.bak-${now.toISOString().replace(/[:.]/g, '-')}`;
    await copyFile(file, backup);
  } else {
    await mkdir(path.dirname(file), { recursive: true });
  }
  const next = { ...config, mcpServers: { ...servers, [MCP_SERVER_KEY]: MCP_SERVER_ENTRY } };
  await writeFileAtomic(file, JSON.stringify(next, null, 2) + '\n');
  return { file, backup, changed: true };
}

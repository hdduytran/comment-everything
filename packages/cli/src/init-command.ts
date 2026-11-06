import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { desktopConfigPath, mergeDesktopConfig } from './claude-desktop-config.js';
import { renderSetupText } from './init-setup-text.js';

export const ASSETS_IGNORE_LINE = '.comments/assets/';

export interface InitOptions {
  /** Directory whose .gitignore is edited; defaults to the cwd. */
  cwd?: string;
  /** Add `.comments/assets/` to .gitignore (default: assets stay tracked). */
  gitignoreAssets?: boolean;
  /** Merge the server into the Claude Desktop config (with a backup). */
  writeDesktopConfig?: boolean;
  /** Override the Desktop config path (tests; defaults to the OS location). */
  desktopConfigFile?: string;
}

/** Append the assets ignore line unless it is already present. Returns true when written. */
async function ignoreAssets(cwd: string): Promise<boolean> {
  const file = path.join(cwd, '.gitignore');
  let existing = '';
  try {
    existing = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (existing.split(/\r?\n/).some((l) => l.trim() === ASSETS_IGNORE_LINE)) return false;
  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  await appendFile(file, `${prefix}${ASSETS_IGNORE_LINE}\n`);
  return true;
}

/** `comment-everything init`: optional .gitignore/Desktop-config edits, then print setup steps. */
export async function initCommand(opts: InitOptions = {}): Promise<string> {
  const cwd = opts.cwd ?? process.cwd();
  const configFile = opts.desktopConfigFile ?? desktopConfigPath();
  const lines: string[] = [];

  if (opts.gitignoreAssets) {
    lines.push(
      (await ignoreAssets(cwd))
        ? `Added ${ASSETS_IGNORE_LINE} to .gitignore`
        : `.gitignore already ignores ${ASSETS_IGNORE_LINE}`,
    );
  } else {
    lines.push(
      `Comments and assets in .comments/ stay tracked by git (pass --gitignore-assets to ignore ${ASSETS_IGNORE_LINE}).`,
    );
  }

  if (opts.writeDesktopConfig) {
    const res = await mergeDesktopConfig(configFile);
    lines.push(
      res.changed
        ? `Updated ${res.file}${res.backup ? ` (backup: ${res.backup})` : ''}; restart Claude Desktop.`
        : `${res.file} already contains comment-everything.`,
    );
  }

  return `${lines.join('\n')}\n\n${renderSetupText({ desktopConfigPath: configFile })}`;
}

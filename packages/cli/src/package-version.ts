import { readFileSync } from 'node:fs';

/**
 * The CLI's own version. The bundle and the source both sit one directory below the package
 * root, so `package.json` is always at `../package.json`.
 */
export function readPackageVersion(): string {
  const manifest = new URL('../package.json', import.meta.url);
  const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown };
  if (typeof parsed.version !== 'string') throw new Error('package.json has no version');
  return parsed.version;
}

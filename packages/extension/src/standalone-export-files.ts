import { formatPrompt, type Comment } from '@comment-everything/core/browser';
import { bytesToBase64 } from './base64-bytes.js';

/** Folder inside the browser's Downloads directory. */
export const EXPORT_ROOT = 'comment-everything';

export interface ExportFile {
  /** Path relative to the Downloads directory, forward slashes. */
  path: string;
  mime: string;
  bytes: Uint8Array;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `yyyy-mm-dd-hhmm` in the user's local time. */
export function exportStamp(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** A host that is safe as a folder name (`localhost:3000` becomes `localhost_3000`). */
export function safeHostName(host: string): string {
  return host.replace(/[^A-Za-z0-9.-]+/g, '_').replace(/^\.+/, '') || 'page';
}

export function exportFolder(host: string, stamp: string): string {
  return `${EXPORT_ROOT}/${safeHostName(host)}/${stamp}`;
}

/**
 * The files of one export: `comments.md` (the prompt, assets referenced as `assets/<id>.png`),
 * `comments.json` (full comment records) and the screenshots those comments use.
 */
export function buildExportFiles(input: {
  folder: string;
  comments: readonly Comment[];
  assets: ReadonlyMap<string, Uint8Array>;
  now: Date;
}): ExportFile[] {
  const text = (path: string, mime: string, body: string): ExportFile => ({
    path: `${input.folder}/${path}`,
    mime,
    bytes: new TextEncoder().encode(body),
  });
  const json = JSON.stringify(
    { exportVersion: 1, exportedAt: input.now.toISOString(), comments: input.comments },
    null,
    2,
  );
  const images = [...input.assets].map(([path, bytes]): ExportFile => ({
    path: `${input.folder}/${path}`,
    mime: 'image/png',
    bytes,
  }));
  return [
    ...images,
    text('comments.json', 'application/json', json + '\n'),
    text('comments.md', 'text/markdown', formatPrompt(input.comments, { assetPrefix: '' })),
  ];
}

/** Asset paths that comments reference (both `assets` and screenshot selectors), deduplicated. */
export function referencedAssets(comments: readonly Comment[]): string[] {
  const paths = new Set<string>();
  for (const c of comments) {
    c.assets.forEach((a) => paths.add(a));
    for (const s of c.selectors) if (s.type === 'ScreenshotSelector') paths.add(s.asset);
  }
  return [...paths];
}

/** `~/Downloads/...` for a real download path; unknown locations are shown as they are. */
export function displayPath(actual: string): string {
  return actual.replace(/^.*?(?=[\\/]Downloads[\\/])/, '~').replace(/\\/g, '/');
}

/** The sentence the user can give to Claude Code. */
export function claudeInstruction(commentsMdPath: string): string {
  return `read ${commentsMdPath} and apply`;
}

/** The subset of `chrome.downloads` the exporter needs. */
export interface DownloadsApi {
  download(opts: {
    url: string;
    filename: string;
    conflictAction: 'uniquify';
    saveAs: false;
  }): Promise<number>;
  search(query: { id: number }): Promise<{ filename: string; state: string }[]>;
}

const POLL_MS = 100;
const WAIT_MS = 15_000;

/** The final on-disk path once the download finishes; throws if it is interrupted. */
async function finished(api: DownloadsApi, id: number): Promise<string> {
  for (let waited = 0; waited < WAIT_MS; waited += POLL_MS) {
    const [item] = await api.search({ id });
    if (item?.state === 'complete') return item.filename;
    if (item?.state === 'interrupted') throw new Error('The download was interrupted');
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error('The download did not finish in time');
}

const dataUrl = (file: ExportFile) => `data:${file.mime};base64,${bytesToBase64(file.bytes)}`;

/**
 * Save every file with `chrome.downloads` (data URLs: service workers have no object URLs).
 * Resolves to the path `comments.md` ended up at, which can differ from the request when a name
 * was already taken (`uniquify`).
 */
export async function saveExportFiles(
  api: DownloadsApi,
  files: readonly ExportFile[],
): Promise<string> {
  const saved = await Promise.all(
    files.map(async (file) => {
      const id = await api.download({
        url: dataUrl(file),
        filename: file.path,
        conflictAction: 'uniquify',
        saveAs: false,
      });
      return { file, path: await finished(api, id) };
    }),
  );
  const md = saved.find((s) => s.file.path.endsWith('/comments.md'));
  if (!md) throw new Error('comments.md was not saved');
  return md.path;
}

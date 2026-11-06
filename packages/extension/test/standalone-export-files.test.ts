import { createComment, type Comment } from '@comment-everything/core/browser';
import { describe, expect, it, vi } from 'vitest';
import {
  buildExportFiles,
  claudeInstruction,
  displayPath,
  exportFolder,
  exportStamp,
  referencedAssets,
  saveExportFiles,
  safeHostName,
  type DownloadsApi,
} from '../src/standalone-export-files.js';
import { PNG_BYTES } from './png-fixture.js';

const now = new Date(2026, 10, 6, 15, 7, 42); // local time: 2026-11-06 15:07
const comment = (text: string, extra: Partial<Parameters<typeof createComment>[0]> = {}): Comment =>
  createComment(
    { source: 'http://localhost:3000/app', text, ...extra },
    { id: `id-${text.replace(/\W/g, '')}`, batchId: 'b1', now },
  );

describe('export layout', () => {
  it('names the folder comment-everything/<host>/<yyyy-mm-dd-hhmm>', () => {
    expect(exportStamp(now)).toBe('2026-11-06-1507');
    expect(exportFolder('localhost:3000', exportStamp(now))).toBe(
      'comment-everything/localhost_3000/2026-11-06-1507',
    );
    expect(safeHostName('../evil/host')).not.toMatch(/[\\/]/);
    expect(safeHostName('')).toBe('page');
  });

  it('produces comments.md, comments.json and the screenshots, with matching references', () => {
    const shot = {
      type: 'ScreenshotSelector' as const,
      rect: { x: 1, y: 2, width: 3, height: 4 },
      asset: 'assets/s1.png',
    };
    const comments = [comment('Make it bigger', { selectors: [shot], assets: ['assets/s1.png'] })];
    const files = buildExportFiles({
      folder: 'comment-everything/h/2026-11-06-1507',
      comments,
      assets: new Map([['assets/s1.png', PNG_BYTES]]),
      now,
    });
    expect(files.map((f) => f.path).sort()).toEqual([
      'comment-everything/h/2026-11-06-1507/assets/s1.png',
      'comment-everything/h/2026-11-06-1507/comments.json',
      'comment-everything/h/2026-11-06-1507/comments.md',
    ]);
    const get = (name: string) => files.find((f) => f.path.endsWith(name))!;
    const md = new TextDecoder().decode(get('comments.md').bytes);
    expect(md).toContain('# Review comments (1)');
    expect(md).toContain('`assets/s1.png`'); // relative to comments.md, no `.comments/` prefix
    expect(md).toContain('> Make it bigger');
    const json = JSON.parse(new TextDecoder().decode(get('comments.json').bytes));
    expect(json.comments).toEqual(JSON.parse(JSON.stringify(comments)));
    expect(json.exportedAt).toBe(now.toISOString());
    expect(get('s1.png').bytes).toEqual(PNG_BYTES);
    expect(get('s1.png').mime).toBe('image/png');
  });

  it('collects each referenced screenshot once', () => {
    const shot = (asset: string) => ({
      type: 'ScreenshotSelector' as const,
      rect: { x: 0, y: 0, width: 1, height: 1 },
      asset,
    });
    const c = comment('x', { selectors: [shot('assets/a.png')], assets: ['assets/a.png'] });
    expect(referencedAssets([c, comment('y', { assets: ['assets/b.png'] })])).toEqual([
      'assets/a.png',
      'assets/b.png',
    ]);
  });

  it('shows the real download location with ~ for the Downloads folder', () => {
    expect(displayPath('/Users/me/Downloads/comment-everything/h/s/comments.md')).toBe(
      '~/Downloads/comment-everything/h/s/comments.md',
    );
    expect(displayPath('C:\\Users\\me\\Downloads\\comment-everything\\h\\comments.md')).toBe(
      '~/Downloads/comment-everything/h/comments.md',
    );
    expect(displayPath('/data/elsewhere/comments.md')).toBe('/data/elsewhere/comments.md');
    expect(claudeInstruction('~/Downloads/x/comments.md')).toBe(
      'read ~/Downloads/x/comments.md and apply',
    );
  });
});

describe('saving through chrome.downloads', () => {
  function fakeDownloads(state = 'complete') {
    const calls: { url: string; filename: string }[] = [];
    const api: DownloadsApi = {
      download: vi.fn(async (o) => calls.push(o)),
      search: vi.fn(async ({ id }) => [
        { filename: `/home/me/Downloads/${calls[id - 1]!.filename}`, state },
      ]),
    };
    return { api, calls };
  }
  const files = [
    {
      path: 'comment-everything/h/s/comments.json',
      mime: 'application/json',
      bytes: new Uint8Array([123, 125]),
    },
    {
      path: 'comment-everything/h/s/comments.md',
      mime: 'text/markdown',
      bytes: new TextEncoder().encode('# hi'),
    },
  ];

  it('downloads every file with data URLs, uniquifying names, and returns the comments.md path', async () => {
    const { api, calls } = fakeDownloads();
    const md = await saveExportFiles(api, files);
    expect(md).toBe('/home/me/Downloads/comment-everything/h/s/comments.md');
    expect(calls.map((c) => c.filename)).toEqual(files.map((f) => f.path));
    expect(calls[1]!.url).toBe(`data:text/markdown;base64,${btoa('# hi')}`);
    expect(api.download).toHaveBeenCalledWith(
      expect.objectContaining({ conflictAction: 'uniquify', saveAs: false }),
    );
  });

  it('fails clearly when a download is interrupted', async () => {
    const { api } = fakeDownloads('interrupted');
    await expect(saveExportFiles(api, files)).rejects.toThrow(/interrupted/);
  });
});

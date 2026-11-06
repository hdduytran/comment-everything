import { createComment } from '@comment-everything/core/browser';
import { describe, expect, it, vi } from 'vitest';
import { bytesToBase64 } from '../src/base64-bytes.js';
import { memoryAssetStore } from '../src/local-asset-store.js';
import {
  copyPromptWithImages,
  promptHtml,
  type RichClipboardWriter,
} from '../src/rich-prompt-clipboard.js';
import { PNG_BYTES, pngBlob } from './png-fixture.js';

const make = (text: string, assets: string[] = []) =>
  createComment(
    {
      source: 'https://example.com/a?x=1&y=2',
      text,
      assets,
      selectors: [{ type: 'TextQuoteSelector', exact: '<b>quoted</b>' }],
    },
    { id: 'c1', batchId: 'b' },
  );

const writer = (): RichClipboardWriter & { text: string[]; rich: [string, string][] } => {
  const text: string[] = [];
  const rich: [string, string][] = [];
  return {
    text,
    rich,
    writeText: async (t) => void text.push(t),
    writeRich: async (h, t) => void rich.push([h, t]),
  };
};

describe('rich prompt', () => {
  it('escapes untrusted comment text and inlines screenshots as data URLs', () => {
    const html = promptHtml(
      [make('<img src=x onerror=alert(1)>', ['assets/a.png'])],
      new Map([['assets/a.png', 'data:image/png;base64,AAAA']]),
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&#60;img src=x onerror=alert(1)&#62;');
    expect(html).toContain('<img src="data:image/png;base64,AAAA"');
    expect(html).toContain('&#38;y=2');
    expect(html).toContain('&#60;b&#62;quoted');
  });

  it('writes text/html with the images plus text/plain when the batch has screenshots', async () => {
    const assets = memoryAssetStore();
    const path = await assets.put(pngBlob());
    const w = writer();
    const comments = [make('Look', [path])];
    const embedded = await copyPromptWithImages('PLAIN PROMPT', comments, assets, w);
    expect(embedded).toBe(1);
    expect(w.text).toEqual([]);
    expect(w.rich[0]![1]).toBe('PLAIN PROMPT');
    expect(w.rich[0]![0]).toContain(`data:image/png;base64,${bytesToBase64(PNG_BYTES)}`);
  });

  it('copies plain text when there are no screenshots', async () => {
    const w = writer();
    expect(await copyPromptWithImages('PLAIN', [make('No shot')], memoryAssetStore(), w)).toBe(0);
    expect(w.text).toEqual(['PLAIN']);
    expect(w.rich).toEqual([]);
  });

  it('falls back to plain text when rich clipboard items are unavailable', async () => {
    const assets = memoryAssetStore();
    const path = await assets.put(pngBlob());
    const w = writer();
    w.writeRich = async () => {
      throw new Error('blocked');
    };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await copyPromptWithImages('PLAIN', [make('x', [path])], assets, w)).toBe(0);
    expect(w.text).toEqual(['PLAIN']);
  });
});

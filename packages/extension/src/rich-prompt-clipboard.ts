import { describeSelector, type Comment } from '@comment-everything/core/browser';
import { bytesToBase64 } from './base64-bytes.js';
import type { AssetStore } from './local-asset-store.js';
import { referencedAssets } from './standalone-export-files.js';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`).replace(/\r?\n/g, '<br>');

/** `describeSelector` marks code with backticks; turn those into <code>. */
const withCode = (s: string) => escapeHtml(s).replace(/`([^`]+)`/g, '<code>$1</code>');

/**
 * HTML twin of the Markdown prompt for a rich paste. Screenshots are inlined as data URLs so they
 * survive pasting into apps that accept images in HTML (Claude Desktop, claude.ai).
 * Comment text is page-derived and untrusted: everything is escaped.
 */
export function promptHtml(
  comments: readonly Comment[],
  images: ReadonlyMap<string, string>,
): string {
  const items = comments.map((c, i) => {
    const where = c.selectors.map((s) => `<li>Location: ${withCode(describeSelector(s))}</li>`);
    const quotes = c.selectors.flatMap((s) =>
      s.type === 'TextQuoteSelector' ? [`<blockquote>${escapeHtml(s.exact)}</blockquote>`] : [],
    );
    const shots = referencedAssets([c]).flatMap((path) => {
      const src = images.get(path);
      return src ? [`<p><img src="${src}" alt="Screenshot for comment ${i + 1}"></p>`] : [];
    });
    return [
      `<h3>${i + 1}. <code>${escapeHtml(c.source)}</code></h3>`,
      `<ul>${where.join('')}</ul>`,
      ...quotes,
      `<p><b>Comment:</b></p><blockquote>${escapeHtml(c.text || '(no text)')}</blockquote>`,
      ...shots,
    ].join('');
  });
  return [
    `<h2>Review comments (${comments.length})</h2>`,
    "<p>Address each comment below. Each one names the source URL, where in it the comment applies, and the reviewer's note.</p>",
    ...items,
  ].join('');
}

/** Clipboard pieces the writer receives; kept free of DOM types so tests can supply a stub. */
export interface RichClipboardWriter {
  writeText(text: string): Promise<void>;
  /** Write HTML and plain text together. Rejects when rich clipboard items are unsupported. */
  writeRich(html: string, text: string): Promise<void>;
}

export function browserClipboardWriter(
  plainFallback: (text: string) => Promise<void>,
): RichClipboardWriter {
  return {
    writeText: plainFallback,
    async writeRich(html, text) {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        throw new Error('Rich clipboard is not supported');
      }
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
    },
  };
}

async function toDataUrl(blob: Blob): Promise<string> {
  return `data:image/png;base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`;
}

/**
 * Copy the prompt. With screenshots it writes text/html (images embedded) plus text/plain; if
 * that is not possible (no screenshots, unsupported, blocked) it falls back to plain text.
 * Resolves to how many screenshots were embedded.
 */
export async function copyPromptWithImages(
  text: string,
  comments: readonly Comment[],
  assets: AssetStore,
  writer: RichClipboardWriter,
): Promise<number> {
  const images = new Map<string, string>();
  for (const path of referencedAssets(comments)) {
    const blob = await assets.get(path).catch(() => null);
    if (blob) images.set(path, await toDataUrl(blob));
  }
  if (images.size > 0) {
    try {
      await writer.writeRich(promptHtml(comments, images), text);
      return images.size;
    } catch (err) {
      console.warn('[comment-everything] rich copy unavailable, copying text only:', err);
    }
  }
  await writer.writeText(text);
  return 0;
}

import type { Selector } from '@comment-everything/core/browser';
import {
  createInPageContentAdapter,
  quoteSelectorsForRange,
  resolveSelectors,
} from '@comment-everything/overlay';
import { blockForLine, lineRangeForElement, lineRangeForRange } from './markdown-line-selectors.js';
import { createMarkdownRenderer } from './markdown-render.js';
import { createUrlResolver } from './markdown-url-resolver.js';
import { renderMermaidBlocks } from './mermaid-lazy.js';
import { fileUrl, type ViewerMount } from './viewer-config.js';

const quotesOnly = (sels: Selector[]) => sels.filter((s) => s.type === 'TextQuoteSelector');

/**
 * Render a Markdown file with every block tagged by its source lines. Comments carry a
 * LineRangeSelector (what the agent edits) plus a TextQuote of the rendered text. The page is
 * re-rendered whenever the file changes on disk.
 */
export const mountMarkdownViewer: ViewerMount = async (container, cfg, daemon) => {
  const article = document.createElement('article');
  article.className = 'ce-markdown';
  container.replaceChildren(article);
  const md = createMarkdownRenderer(createUrlResolver(cfg));
  let sourceLines: string[] = [];
  let lastText: string | null = null;

  const adapter = createInPageContentAdapter({
    textRoot: article,
    captureRoot: article,
    hooks: {
      selectorsForElement(el) {
        const line = lineRangeForElement(el, article);
        const range = document.createRange();
        range.selectNodeContents(el);
        return [...(line ? [line] : []), ...quotesOnly(quoteSelectorsForRange(range, article))];
      },
      selectorsForRange(range) {
        const line = lineRangeForRange(range, article, sourceLines);
        return [...(line ? [line] : []), ...quotesOnly(quoteSelectorsForRange(range, article))];
      },
      resolve(sels) {
        // Prefer the precise quote; fall back to the block that holds the line range.
        const byText = resolveSelectors(
          document,
          article,
          sels.filter((s) => s.type !== 'LineRangeSelector'),
        );
        if (byText) return byText;
        const line = sels.find((s) => s.type === 'LineRangeSelector');
        return line ? blockForLine(article, line.startLine) : null;
      },
    },
  });

  async function load(): Promise<void> {
    try {
      const res = await fetch(fileUrl(cfg, cfg.source, false), {
        headers: { 'x-ce-token': cfg.token },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`Daemon responded ${res.status}`);
      const text = await res.text();
      if (text === lastText) return; // nothing changed (e.g. catch-up reload after connecting)
      lastText = text;
      sourceLines = text.split(/\r?\n/);
      const scrollY = window.scrollY;
      article.innerHTML = md.render(text); // raw HTML is disabled in the renderer
      await renderMermaidBlocks(article);
      window.scrollTo(0, scrollY);
      adapter.refresh?.();
    } catch (err) {
      article.textContent = `Could not load ${cfg.source}: ${(err as Error).message}`;
    }
  }
  // Subscribe before the first render so an edit made while loading is not missed; the stream's
  // `ready` event also reloads once to pick up anything written before it connected.
  const off = daemon.subscribe((e) => {
    if (e.type === 'ready' || (e.type === 'file.changed' && e.path === cfg.source)) void load();
  });
  await load();
  return {
    adapter,
    dispose() {
      off();
      adapter.dispose();
      article.remove();
    },
  };
};

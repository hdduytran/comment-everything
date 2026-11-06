import hljs from 'highlight.js/lib/common';
import MarkdownIt from 'markdown-it';
import type { StateCore, Token } from 'markdown-it';
import { LINE_END, LINE_START } from './markdown-line-selectors.js';

export interface UrlResolver {
  /** Map an image `src` to a loadable URL, or '' to drop it. */
  image(src: string): string;
  /** Map a link `href`; `external` links open in a new tab. */
  link(href: string): { href: string; external: boolean };
}

/** Tag every block token with the 1-based inclusive source lines it came from. */
function lineMapPlugin(md: MarkdownIt): void {
  md.core.ruler.push('ce_line_map', (state: StateCore) => {
    const lines = state.src.split('\n');
    for (const t of state.tokens) {
      if (t.map && t.block && t.type !== 'inline' && t.nesting >= 0) {
        const start = t.map[0] + 1;
        // Container blocks (lists, quotes) swallow trailing blank lines; do not report them.
        let end = t.map[1];
        while (end > start && (lines[end - 1] ?? '').trim() === '') end--;
        t.attrSet(LINE_START, String(start));
        t.attrSet(LINE_END, String(end));
      }
    }
  });
}

/** GitHub-style `- [x]` task list items rendered as disabled checkboxes. */
function taskListPlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'ce_task_list', (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i] as Token;
      const m = /^\[([ xX])\][ \t]/.exec(inline.content);
      if (inline.type !== 'inline' || !m || tokens[i - 1]?.type !== 'paragraph_open') continue;
      const item = tokens[i - 2];
      const first = inline.children?.[0];
      if (item?.type !== 'list_item_open' || first?.type !== 'text') continue;
      item.attrJoin('class', 'task-list-item');
      first.content = first.content.slice(m[0].length);
      const box = new state.Token('html_inline', '', 0);
      box.content = `<input type="checkbox" disabled${m[1] === ' ' ? '' : ' checked'}> `;
      inline.children?.unshift(box);
    }
  });
}

/** Markdown renderer: raw HTML disabled (content is untrusted), GFM tables/strikethrough/links. */
export function createMarkdownRenderer(urls: UrlResolver): MarkdownIt {
  const md: MarkdownIt = new MarkdownIt({
    html: false,
    linkify: true,
    highlight(code, lang) {
      if (!lang || !hljs.getLanguage(lang)) return ''; // '' -> escaped plain text
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    },
  });
  md.use(lineMapPlugin).use(taskListPlugin);

  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx] as Token;
    if (token.info.trim().split(/\s+/)[0] === 'mermaid') {
      return `<pre class="mermaid"${self.renderAttrs(token)}>${md.utils.escapeHtml(token.content)}</pre>\n`;
    }
    return fence ? fence(tokens, idx, options, env, self) : '';
  };

  const image = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx] as Token;
    token.attrSet('src', urls.image(token.attrGet('src') ?? ''));
    token.attrSet('loading', 'lazy');
    return image ? image(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  };

  const linkOpen = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx] as Token;
    const target = urls.link(token.attrGet('href') ?? '');
    token.attrSet('href', target.href);
    if (target.external) {
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
    }
    return linkOpen
      ? linkOpen(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  };
  return md;
}

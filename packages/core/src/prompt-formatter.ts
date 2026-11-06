import type { Comment } from './comment-schema.js';
import { parseMediaFragment, type Selector } from './selector-schemas.js';

/** `mm:ss.mmm` (minutes keep growing past 99, e.g. `120:05.250`). */
export function formatTimecode(sec: number): string {
  const totalMs = Math.round(Math.max(0, sec) * 1000);
  const m = Math.floor(totalMs / 60_000);
  const s = ((totalMs % 60_000) / 1000).toFixed(3).padStart(6, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
}

/** `00:12.400–00:15.000`, or a single timecode for a point comment. */
function formatTimeRange(t: { start: number; end?: number }): string {
  return t.end === undefined || t.end === t.start
    ? formatTimecode(t.start)
    : `${formatTimecode(t.start)}\u2013${formatTimecode(t.end)}`;
}

/** Quote a block of text as a Markdown blockquote, preserving line breaks. */
function blockquote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => `> ${l}`.trimEnd())
    .join('\n');
}

/** One-line human description of where a selector points. */
export function describeSelector(sel: Selector): string {
  switch (sel.type) {
    case 'TextQuoteSelector':
      return 'text quote';
    case 'TextPositionSelector':
      return `text offsets ${sel.start}-${sel.end}`;
    case 'CssSelector':
      return `CSS selector \`${sel.value}\``;
    case 'XPathSelector':
      return `XPath \`${sel.value}\``;
    case 'LineRangeSelector':
      return sel.startLine === sel.endLine
        ? `line ${sel.startLine}`
        : `lines ${sel.startLine}-${sel.endLine}`;
    case 'FragmentSelector': {
      const t = parseMediaFragment(sel);
      if (!t) return `fragment ${sel.value}`;
      return `time ${formatTimeRange(t)}`;
    }
    case 'ScreenshotSelector': {
      const { x, y, width, height } = sel.rect;
      return `screenshot region ${width}x${height} at (${x}, ${y})`;
    }
  }
}

function formatComment(c: Comment, index: number): string {
  const range = c.selectors.flatMap((s) =>
    s.type === 'FragmentSelector' ? [parseMediaFragment(s)] : [],
  )[0];
  const where = range ? `${c.source} @ ${formatTimeRange(range)}` : c.source;
  const lines: string[] = [`## ${index}. \`${where}\` (id: ${c.id})`];
  for (const sel of c.selectors) {
    lines.push(`- Location: ${describeSelector(sel)}`);
    if (sel.type === 'TextQuoteSelector') lines.push(blockquote(sel.exact));
  }
  if (c.anchorState === 'orphaned') {
    lines.push('- Anchor: detached (the commented content no longer exists at this location)');
  }
  lines.push('- Comment:', blockquote(c.text || '(no text)'));
  if (c.assets.length > 0) {
    lines.push('- Assets:', ...c.assets.map((a) => `  - \`.comments/${a}\``));
  }
  if (c.transcript?.text) lines.push('- Transcript:', blockquote(c.transcript.text));
  return lines.join('\n');
}

/**
 * Render comments as a self-contained Markdown prompt for pasting into any agent.
 * Output is deterministic for a given input order.
 */
export function formatPrompt(comments: readonly Comment[]): string {
  if (comments.length === 0) return 'No comments.\n';
  const header = [
    `# Review comments (${comments.length})`,
    '',
    "Address each comment below. Each one names the source file or URL, where in it the comment applies, and the reviewer's note.",
    '',
  ];
  const body = comments.map((c, i) => formatComment(c, i + 1)).join('\n\n');
  return [...header, body, ''].join('\n');
}

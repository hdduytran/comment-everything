import type { Comment, CommentInput } from '@comment-everything/core/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Anchor,
  ContentAdapter,
  DaemonEvent,
  DaemonTransport,
  PinSpec,
} from '../src/host-adapter.js';
import { createOverlay } from '../src/overlay-root-shadow-dom.js';
import { buildPrompt } from '../src/overlay-state.js';

function fakeContent() {
  const anchorCbs = new Set<(a: Anchor) => void>();
  const calls = { modes: [] as (string | null)[], pins: [] as PinSpec[][] };
  const adapter: ContentAdapter = {
    setMode: (m) => void calls.modes.push(m),
    onAnchor: (cb) => (anchorCbs.add(cb), () => anchorCbs.delete(cb)),
    onPinClick: () => () => undefined,
    onCancel: () => () => undefined,
    setPins: (p) => void calls.pins.push(p),
    focusPin: () => undefined,
    dispose: () => undefined,
  };
  return { adapter, calls, emit: (a: Anchor) => anchorCbs.forEach((cb) => cb(a)) };
}

const sentComment = (over: Partial<Comment> = {}): Comment => ({
  schemaVersion: 1,
  id: 'c1',
  source: 'docs/page.html',
  selectors: [{ type: 'CssSelector', value: '#a' }],
  text: 'Fix this',
  status: 'open',
  assets: [],
  createdAt: '2026-11-06T04:00:00.000Z',
  updatedAt: '2026-11-06T04:00:00.000Z',
  batchId: 'b1',
  ...over,
});

function fakeDaemon() {
  let handler: ((e: DaemonEvent) => void) | undefined;
  const daemon: DaemonTransport = {
    sendBatch: vi.fn(async (comments: CommentInput[]) => ({
      batchId: 'b1',
      comments: comments.map((c, i) => sentComment({ id: `c${i + 1}`, text: c.text })),
    })),
    uploadAsset: vi.fn(async () => 'assets/shot.png'),
    listComments: vi.fn(async () => []),
    subscribe: (h) => ((handler = h), () => (handler = undefined)),
  };
  return { daemon, push: (e: DaemonEvent) => handler?.(e) };
}

const anchor = (css: string, label: string): Anchor => ({
  selectors: [
    { type: 'CssSelector', value: css },
    { type: 'TextQuoteSelector', exact: label },
  ],
  label,
});

let mountEl: HTMLElement;
beforeEach(() => {
  mountEl = document.createElement('div');
  document.body.append(mountEl);
});
afterEach(() => mountEl.remove());

const ui = () => mountEl.querySelector('[data-ce-host]')!.shadowRoot!;
const q = <T extends Element>(sel: string) => ui().querySelector(sel) as T;
const qa = (sel: string) => [...ui().querySelectorAll(sel)] as HTMLElement[];
const sendArgs = (d: DaemonTransport) =>
  (d.sendBatch as unknown as { mock: { calls: [CommentInput[]][] } }).mock.calls[0]!;
/** Real typing produces a bubbling, composed `input` event; the overlay relies on that. */
const USER_INPUT = { bubbles: true, composed: true };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('overlay', () => {
  it('captures anchors as numbered drafts and sends them as one batch', async () => {
    const content = fakeContent();
    const { daemon } = fakeDaemon();
    const handle = createOverlay({
      source: 'docs/page.html',
      content: content.adapter,
      daemon,
      mount: mountEl,
    });

    content.emit(anchor('#a', 'Alpha'));
    content.emit(anchor('#b', 'Beta'));
    await tick();
    expect(handle.pendingCount()).toBe(2);
    expect(content.calls.pins.at(-1)!.map((p) => p.n)).toEqual([1, 2]);

    const areas = qa('[data-ce=draft-text]') as unknown as HTMLTextAreaElement[];
    areas[0]!.value = 'Make it bigger';
    areas[0]!.dispatchEvent(new Event('input', USER_INPUT));
    q<HTMLButtonElement>('[data-ce=send]').click();
    await tick();
    expect(daemon.sendBatch).not.toHaveBeenCalled(); // second draft is still empty
    expect(q('[data-ce=toast]').textContent).toContain('Write a comment');

    areas[1]!.value = 'Rename it';
    areas[1]!.dispatchEvent(new Event('input', USER_INPUT));
    q<HTMLButtonElement>('[data-ce=send]').click();
    await tick();
    expect(daemon.sendBatch).toHaveBeenCalledOnce();
    const [inputs] = sendArgs(daemon);
    expect(inputs).toMatchObject([
      { source: 'docs/page.html', text: 'Make it bigger' },
      { source: 'docs/page.html', text: 'Rename it' },
    ]);
    expect(handle.pendingCount()).toBe(0);
    expect(qa('[data-ce=sent-item]')).toHaveLength(2);
    handle.dispose();
  });

  it('uploads region screenshots and adds a ScreenshotSelector', async () => {
    const content = fakeContent();
    const { daemon } = fakeDaemon();
    createOverlay({ source: 'a.html', content: content.adapter, daemon, mount: mountEl });
    content.emit({
      selectors: [],
      label: 'Region 10×10',
      screenshot: {
        rect: { x: 1, y: 2, width: 10, height: 10 },
        png: new Blob(['x'], { type: 'image/png' }),
      },
    });
    await tick();
    const area = q<HTMLTextAreaElement>('[data-ce=draft-text]');
    area.value = 'Looks off';
    area.dispatchEvent(new Event('input', USER_INPUT));
    q<HTMLButtonElement>('[data-ce=send]').click();
    await tick();
    const [inputs] = sendArgs(daemon);
    expect(inputs[0]!.assets).toEqual(['assets/shot.png']);
    expect(inputs[0]!.selectors![0]).toMatchObject({
      type: 'ScreenshotSelector',
      asset: 'assets/shot.png',
      rect: { x: 1, y: 2, width: 10, height: 10 },
    });
  });

  it('shows live status and the agent note from SSE events, only for its own source', async () => {
    const content = fakeContent();
    const { daemon, push } = fakeDaemon();
    createOverlay({ source: 'docs/page.html', content: content.adapter, daemon, mount: mountEl });
    push({ type: 'comment.created', comment: sentComment() });
    push({ type: 'comment.created', comment: sentComment({ id: 'other', source: 'x.md' }) });
    await tick();
    expect(qa('[data-ce=sent-item]')).toHaveLength(1);
    expect(q<HTMLElement>('[data-ce=sent-item]').dataset.status).toBe('open');

    push({
      type: 'comment.updated',
      comment: sentComment({ status: 'resolved', resolution: '<img src=x onerror=alert(1)> done' }),
    });
    expect(q<HTMLElement>('[data-ce=sent-item]').dataset.status).toBe('resolved');
    // Agent text is untrusted: rendered as text, never as markup.
    expect(q('[data-ce=note]').textContent).toBe('Agent: <img src=x onerror=alert(1)> done');
    expect(ui().querySelector('img')).toBeNull();
    push({ type: 'comment.deleted', id: 'c1' });
    expect(qa('[data-ce=sent-item]')).toHaveLength(0);
  });

  it('copies a self-contained prompt for the pending drafts', async () => {
    const content = fakeContent();
    const { daemon } = fakeDaemon();
    const copyText = vi.fn(async () => undefined);
    createOverlay({
      source: 'docs/page.html',
      content: content.adapter,
      daemon,
      mount: mountEl,
      copyText,
    });
    content.emit(anchor('#a', 'Alpha'));
    await tick();
    const area = q<HTMLTextAreaElement>('[data-ce=draft-text]');
    area.value = 'Use a darker colour';
    area.dispatchEvent(new Event('input', USER_INPUT));
    q<HTMLButtonElement>('[data-ce=copy]').click();
    await tick();
    expect(copyText).toHaveBeenCalledOnce();
    expect((copyText.mock.calls as unknown as string[][])[0]![0]).toMatchSnapshot();
  });

  it('clear removes drafts and pins; mode buttons toggle capture modes', async () => {
    const content = fakeContent();
    const { daemon } = fakeDaemon();
    createOverlay({ source: 'a.html', content: content.adapter, daemon, mount: mountEl });
    q<HTMLButtonElement>('[data-ce=mode-element]').click();
    q<HTMLButtonElement>('[data-ce=mode-element]').click();
    q<HTMLButtonElement>('[data-ce=mode-text]').click();
    expect(content.calls.modes).toEqual(['element', null, 'text']);
    content.emit(anchor('#a', 'Alpha'));
    await tick();
    q<HTMLButtonElement>('[data-ce=clear]').click();
    expect(qa('[data-ce=draft]')).toHaveLength(0);
    expect(content.calls.pins.at(-1)).toEqual([]);
  });
});

describe('buildPrompt', () => {
  it('renders drafts with their selectors in the shared prompt format', () => {
    const prompt = buildPrompt(
      [
        {
          id: 'd1',
          label: 'x',
          text: 'Tighten this copy',
          assets: [],
          selectors: [
            { type: 'LineRangeSelector', startLine: 4, endLine: 6 },
            { type: 'TextQuoteSelector', exact: 'Hello world' },
          ],
        },
      ],
      'README.md',
      new Date('2026-11-06T04:00:00Z'),
    );
    expect(prompt).toContain('`README.md`');
    expect(prompt).toContain('lines 4-6');
    expect(prompt).toContain('> Tighten this copy');
  });
});

import type { Comment, CommentInput, CommentStatus } from '@comment-everything/core/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryConfig, DeliveryOutcome } from '../src/host-adapter.js';
import { createOverlay } from '../src/overlay-root-shadow-dom.js';
import { anchor, fakeContent, fakeDaemon, tick } from './overlay-fakes.js';

let mountEl: HTMLElement;
beforeEach(() => {
  mountEl = document.createElement('div');
  document.body.append(mountEl);
});
afterEach(() => mountEl.remove());

const root = () => mountEl.querySelector('[data-ce-host]')!.shadowRoot!;
const q = <T extends Element>(sel: string) => root().querySelector(sel) as T;
const click = async (sel: string) => {
  q<HTMLElement>(sel).click();
  await tick();
};

function mount(overrides: Partial<DeliveryConfig> = {}, withEditing = false) {
  const content = fakeContent();
  const d = fakeDaemon();
  const exported: Comment[][] = [];
  const opened: Comment[][] = [];
  const delivery: DeliveryConfig = {
    mode: {
      label: 'Extension only',
      tip: 'Extension only — comments stay in this browser',
    },
    assetPrefix: '',
    primary: {
      id: 'export',
      label: 'Export',
      tip: 'Save the comments as files.',
      run: vi.fn(async (comments): Promise<DeliveryOutcome> => {
        exported.push(comments);
        return {
          text: 'Exported 1 comment. Ask Claude Code: read ~/x/comments.md and apply',
          copy: { text: 'read ~/x/comments.md and apply', tip: 'Copy this sentence.' },
        };
      }),
    },
    secondary: [
      {
        id: 'open-claude',
        label: 'Open in Claude',
        tip: 'Copy the prompt and open claude.ai.',
        run: vi.fn(async (comments) => {
          opened.push(comments);
          return { text: 'Prompt copied — paste in Claude' };
        }),
      },
    ],
    ...overrides,
  };
  if (withEditing) {
    let stored: Comment | undefined;
    const send = d.daemon.sendBatch;
    d.daemon.sendBatch = async (c: CommentInput[]) => {
      const r = await send(c);
      stored = r.comments[0];
      return r;
    };
    d.daemon.updateStatus = vi.fn(async (_id: string, status: CommentStatus) => ({
      ...stored!,
      status,
    }));
    d.daemon.deleteComment = vi.fn(async () => undefined);
  }
  const copyText = vi.fn(async () => undefined);
  const handle = createOverlay({
    source: 'https://example.com/',
    content: content.adapter,
    daemon: d.daemon,
    mount: mountEl,
    copyText,
    delivery,
  });
  content.emit(anchor('#title', 'h1 Title'));
  return { content, d, delivery, exported, opened, copyText, handle };
}

async function writeComment(text: string) {
  const area = q<HTMLTextAreaElement>('textarea');
  area.value = text;
  area.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await tick();
}

describe('standalone delivery UI', () => {
  it('shows the mode in the pill with the required tooltip, and Export in place of Send', async () => {
    mount();
    await tick();
    expect(q('[data-ce=agent-status] .agent-label').textContent).toBe('Extension only');
    expect(q('[data-ce=agent-status]').getAttribute('data-kind')).toBe('local');
    const tipId = q('[data-ce=agent-status]').getAttribute('aria-describedby')!;
    expect(root().getElementById(tipId)!.textContent).toBe(
      'Extension only — comments stay in this browser',
    );
    expect(q('[data-ce=send] span').textContent).toBe('Export (1)');
    expect(q('[data-ce=copy]')).not.toBeNull();
    // every new control is described by a tooltip
    for (const sel of ['send', 'delivery-open-claude']) {
      const id = q(`[data-ce=${sel}]`).getAttribute('aria-describedby')!;
      expect(root().getElementById(id)!.getAttribute('role')).toBe('tooltip');
    }
    expect(
      root().getElementById(q('[data-ce=send]').getAttribute('aria-describedby')!)!.textContent,
    ).toContain('Save the comments as files.');
  });

  it('Export saves the drafts first, then delivers the saved batch and offers the sentence to copy', async () => {
    const { d, exported, copyText } = mount();
    await writeComment('Make it bigger');
    await click('[data-ce=send]');
    expect(d.daemon.sendBatch).toHaveBeenCalledWith([
      expect.objectContaining({ text: 'Make it bigger' }),
    ]);
    expect(exported[0]).toHaveLength(1);
    expect(q('[data-ce=toast] .toast-text').textContent).toContain('Ask Claude Code: read ~/x');
    const copyBtn = q<HTMLElement>('[data-ce=toast-copy]');
    expect(copyBtn.hidden).toBe(false);
    copyBtn.click();
    await tick();
    expect(copyText).toHaveBeenCalledWith('read ~/x/comments.md and apply');
    expect(q('[data-ce=draft]')).toBeNull(); // pending drafts moved to the saved list
  });

  it('keeps the comment saved and says so when the delivery step fails', async () => {
    const { d } = mount({
      primary: {
        id: 'export',
        label: 'Export',
        tip: 't',
        run: async () => {
          throw new Error('Downloads are blocked');
        },
      },
    });
    await writeComment('x');
    await click('[data-ce=send]');
    expect(d.daemon.sendBatch).toHaveBeenCalledOnce();
    expect(q('[data-ce=toast]').getAttribute('role')).toBe('alert');
    expect(q('[data-ce=toast] .toast-text').textContent).toMatch(
      /Saved in this browser, but export failed: Downloads are blocked/,
    );
  });

  it('a secondary action works on the pending drafts and leaves them in place', async () => {
    const { d, opened } = mount();
    await writeComment('Check this');
    await click('[data-ce=delivery-open-claude]');
    expect(opened[0]![0]).toMatchObject({ text: 'Check this' });
    expect(d.daemon.sendBatch).not.toHaveBeenCalled();
    expect(q('[data-ce=draft]')).not.toBeNull();
    expect(q('[data-ce=toast] .toast-text').textContent).toBe('Prompt copied — paste in Claude');
  });

  it('Copy prompt uses the host copy hook with the draft comments', async () => {
    const copyPrompt = vi.fn(async () => undefined);
    mount({ copyPrompt });
    await writeComment('Rich please');
    await click('[data-ce=copy]');
    expect(copyPrompt).toHaveBeenCalledWith(
      expect.stringContaining('> Rich please'),
      expect.arrayContaining([expect.objectContaining({ text: 'Rich please' })]),
    );
  });

  it('Export and Open in Claude are inactive until there is a comment', async () => {
    mount();
    await tick();
    q<HTMLElement>('[data-ce=clear]').click();
    await tick();
    expect(q('[data-ce=send]').getAttribute('aria-disabled')).toBe('true');
    expect(q('[data-ce=delivery-open-claude]').getAttribute('aria-disabled')).toBe('true');
  });

  it('the help sheet starts with the Extension only tab and the upgrade steps', async () => {
    mount();
    await click('[data-ce=agent-status]');
    const tabs = [...root().querySelectorAll('[role=tab]')].map((t) => t.textContent);
    expect(tabs[0]).toBe('Extension only');
    expect(tabs).toContain('Claude Code');
    const first = q('[role=tabpanel]:not([hidden])').textContent!;
    expect(first).toContain('Copy prompt');
    expect(first).toContain('Export');
    expect(first).toContain('Open in Claude');
    expect(first).toContain('comment-everything serve');
  });

  it('lets the user resolve and delete saved comments when the transport supports it', async () => {
    const { d } = mount({}, true);
    await writeComment('Done soon');
    await click('[data-ce=send]');
    await click('[data-ce=sent-resolve]');
    expect(d.daemon.updateStatus).toHaveBeenCalledWith(expect.any(String), 'resolved');
    expect(q('[data-ce=sent-item]').getAttribute('data-status')).toBe('resolved');
    expect(q('[data-ce=sent-resolve] span').textContent).toBe('Reopen');
    await click('[data-ce=sent-delete]');
    expect(d.daemon.deleteComment).toHaveBeenCalled();
    expect(q('[data-ce=sent-item]')).toBeNull();
  });
});

describe('daemon mode stays unchanged', () => {
  it('has Send, no mode pill override, no resolve buttons and the three original help tabs', async () => {
    const content = fakeContent();
    const d = fakeDaemon();
    createOverlay({ source: 'a.html', content: content.adapter, daemon: d.daemon, mount: mountEl });
    content.emit(anchor('#a', 'A'));
    await tick();
    expect(q('[data-ce=send] span').textContent).toBe('Send (1)');
    expect(q<HTMLElement>('[data-ce=agent-status]').hidden).toBe(true); // no agentsStatus on this fake
    expect(q('[data-ce=delivery-open-claude]')).toBeNull();
    expect(q('[data-ce=offer]')).toBeNull();
    expect([...root().querySelectorAll('[role=tab]')].map((t) => t.textContent)).toEqual([
      'Claude Code',
      'Claude Desktop',
      'Other MCP',
    ]);
  });
});

describe('one-time offer', () => {
  it('runs once, confirms, and disappears', async () => {
    const content = fakeContent();
    const d = fakeDaemon();
    const run = vi.fn(async () => 'Moved 2 comments to the project.');
    createOverlay({
      source: 'a.html',
      content: content.adapter,
      daemon: d.daemon,
      mount: mountEl,
      offer: {
        text: '2 comments saved in this browser.',
        actionLabel: 'Move 2 to project',
        actionTip: 'Move them.',
        run,
      },
    });
    await tick();
    expect(q('[data-ce=offer]').textContent).toContain('2 comments saved in this browser.');
    await click('[data-ce=offer-run]');
    expect(run).toHaveBeenCalledOnce();
    expect(q<HTMLElement>('[data-ce=offer]').hidden).toBe(true);
    expect(q('[data-ce=toast] .toast-text').textContent).toBe('Moved 2 comments to the project.');
  });

  it('stays available with an error when it fails', async () => {
    const content = fakeContent();
    const d = fakeDaemon();
    createOverlay({
      source: 'a.html',
      content: content.adapter,
      daemon: d.daemon,
      mount: mountEl,
      offer: {
        text: 't',
        actionLabel: 'Move',
        actionTip: 'm',
        run: async () => {
          throw new Error('Daemon responded 500');
        },
      },
    });
    await tick();
    await click('[data-ce=offer-run]');
    expect(q<HTMLElement>('[data-ce=offer]').hidden).toBe(false);
    expect(q('[data-ce=toast] .toast-text').textContent).toBe('Daemon responded 500');
  });
});

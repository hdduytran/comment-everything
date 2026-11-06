import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeAgents, describeSendOutcome } from '../src/agent-status-text.js';
import { createOverlay } from '../src/overlay-root-shadow-dom.js';
import {
  agent,
  anchor,
  fakeContent,
  fakeDaemon,
  noAgents,
  realEvent,
  tick,
} from './overlay-fakes.js';

let mountEl: HTMLElement;
beforeEach(() => {
  mountEl = document.createElement('div');
  document.body.append(mountEl);
});
afterEach(() => {
  vi.useRealTimers();
  mountEl.remove();
});

const root = () => mountEl.querySelector('[data-ce-host]')!.shadowRoot!;
const q = <T extends Element>(sel: string) => root().querySelector(sel) as T;

async function mount(status?: ReturnType<typeof agent>) {
  const content = fakeContent();
  const d = fakeDaemon(status);
  const handle = createOverlay({
    source: 'a.html',
    content: content.adapter,
    daemon: d.daemon,
    mount: mountEl,
    copyText: vi.fn(async () => undefined),
  });
  await tick();
  return { content, ...d, handle };
}

describe('tooltips', () => {
  it('every control is described by a role=tooltip element, shown after the delay on hover', async () => {
    await mount();
    vi.useFakeTimers();
    for (const sel of ['mode-element', 'mode-text', 'mode-region', 'send', 'copy', 'clear']) {
      const btn = q<HTMLElement>(`[data-ce=${sel}]`);
      const tip = root().getElementById(btn.getAttribute('aria-describedby')!)!;
      expect(tip.getAttribute('role')).toBe('tooltip');
      expect(tip.hidden).toBe(true);
    }
    const send = q<HTMLElement>('[data-ce=send]');
    const tip = root().getElementById(send.getAttribute('aria-describedby')!)!;
    send.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(399);
    expect(tip.hidden).toBe(true);
    vi.advanceTimersByTime(2);
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toMatch(/Enter/);
    send.dispatchEvent(new MouseEvent('mouseleave'));
    expect(tip.hidden).toBe(true);
  });

  it('shows on keyboard focus and Esc dismisses it without reaching the page', async () => {
    await mount();
    vi.useFakeTimers();
    const page = vi.fn();
    document.addEventListener('keydown', page);
    const btn = q<HTMLButtonElement>('[data-ce=mode-text]');
    const tip = root().getElementById(btn.getAttribute('aria-describedby')!)!;
    btn.focus();
    vi.advanceTimersByTime(450);
    expect(tip.hidden).toBe(false);
    btn.dispatchEvent(realEvent(KeyboardEvent, 'keydown', { key: 'Escape' }));
    expect(tip.hidden).toBe(true);
    expect(page).not.toHaveBeenCalled();
    document.removeEventListener('keydown', page);
  });

  it('keeps Send focusable and described while there is nothing to send', async () => {
    await mount();
    const send = q<HTMLButtonElement>('[data-ce=send]');
    expect(send.getAttribute('aria-disabled')).toBe('true');
    expect(send.disabled).toBe(false);
  });
});

describe('agent connection indicator and Send outcome', () => {
  it.each([
    ['none', noAgents, 'No AI connected'],
    ['connected', agent('claude-ai', false), 'Claude connected (will read on request)'],
    ['watching', agent('claude-code', true), 'Claude Code connected · watching'],
  ])('shows the %s state', async (_k, status, label) => {
    await mount(status);
    expect(q('[data-ce=agent-status]').textContent).toBe(label);
  });

  it('hides the indicator when the host cannot report agent status', async () => {
    await mount();
    expect(q<HTMLElement>('[data-ce=agent-status]').hidden).toBe(true);
  });

  it('updates live from agents.changed events', async () => {
    const m = await mount(noAgents);
    m.push({ type: 'agents.changed', status: agent('claude-code', true) });
    expect(q('[data-ce=agent-status]').textContent).toBe('Claude Code connected · watching');
  });

  it.each([
    [agent('claude-code', true), 'Sent — Claude is picking it up', false],
    [
      agent('claude-ai', false),
      "Sent. In Claude, run /comments (or say 'check my comments')",
      false,
    ],
    [noAgents, 'Saved. Connect Claude:', true],
  ])('tells the user what happens after Send', async (status, text, hasAction) => {
    const m = await mount(status);
    m.content.emit(anchor('#a', 'Alpha'));
    const area = q<HTMLTextAreaElement>('textarea');
    area.value = 'x';
    area.dispatchEvent(realEvent(Event, 'input'));
    q<HTMLButtonElement>('[data-ce=send]').click();
    await tick();
    expect(q('[data-ce=toast] .toast-text').textContent).toBe(text);
    expect(q<HTMLElement>('[data-ce=toast-connect]').hidden).toBe(!hasAction);
  });

  it('"How to connect" opens the help sheet with three tabs and copyable commands', async () => {
    const m = await mount(noAgents);
    m.content.emit(anchor('#a', 'Alpha'));
    const area = q<HTMLTextAreaElement>('textarea');
    area.value = 'x';
    area.dispatchEvent(realEvent(Event, 'input'));
    q<HTMLButtonElement>('[data-ce=send]').click();
    await tick();
    q<HTMLButtonElement>('[data-ce=toast-connect]').click();
    const help = q<HTMLElement>('[data-ce=help]');
    expect(help.hidden).toBe(false);
    expect(root().querySelectorAll('[role=tab]')).toHaveLength(3);
    expect(help.textContent).toContain(
      'claude mcp add comment-everything -- comment-everything mcp',
    );
    // Esc closes the sheet.
    help
      .querySelector('[role=tab]')!
      .dispatchEvent(realEvent(KeyboardEvent, 'keydown', { key: 'Escape' }));
    expect(help.hidden).toBe(true);
  });
});

describe('collapse', () => {
  it('collapses to a handle and tells the host through an attribute', async () => {
    await mount();
    const host = mountEl.querySelector<HTMLElement>('[data-ce-host]')!;
    expect(host.dataset.cePanel).toBe('open');
    q<HTMLButtonElement>('[data-ce=collapse]').click();
    expect(host.dataset.cePanel).toBe('collapsed');
    expect(q('.shell').hasAttribute('data-collapsed')).toBe(true);
    q<HTMLButtonElement>('[data-ce=handle]').click();
    expect(host.dataset.cePanel).toBe('open');
  });
});

describe('agent status text', () => {
  it('uses plain names and falls back to the reported client name', () => {
    expect(describeAgents(agent('cursor', false))?.label).toBe(
      'cursor connected (will read on request)',
    );
    expect(describeAgents(null)).toBeNull();
    expect(describeSendOutcome(null, 2).text).toBe('Sent 2 comments.');
  });
});

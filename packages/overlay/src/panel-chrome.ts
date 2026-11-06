import { el } from './dom-helpers.js';
import { icon, type IconName } from './icons.js';
import type { CaptureMode } from './host-adapter.js';
import type { TooltipController, TooltipHandle } from './tooltip-controller.js';

/** Builders for the panel's static chrome: header, mode bar, footer. Behaviour stays in SidePanel. */

const MODES: { mode: CaptureMode; label: string; icon: IconName; tip: string }[] = [
  {
    mode: 'element',
    label: 'Element',
    icon: 'element',
    tip: 'Click an element on the page to comment on it. Stop with',
  },
  {
    mode: 'text',
    label: 'Text',
    icon: 'text',
    tip: 'Select text on the page to comment on that passage. Stop with',
  },
  {
    mode: 'region',
    label: 'Region',
    icon: 'region',
    tip: 'Drag a box over any area. A screenshot of it is attached. Stop with',
  },
];
export const SEND_TIP = 'Save these comments and hand them to Claude, all at once.';
export const SEND_TIP_EMPTY = 'Nothing to send yet. Add a comment first.';

export function labelledButton(
  doc: Document,
  text: string,
  attrs: Record<string, string>,
  ic?: IconName,
): HTMLButtonElement {
  const b = el(doc, 'button', { type: 'button', ...attrs });
  if (ic) b.append(icon(doc, ic));
  b.append(el(doc, 'span', { text }));
  return b;
}

export function iconButton(
  doc: Document,
  ic: IconName,
  label: string,
  ce: string,
): HTMLButtonElement {
  const b = el(doc, 'button', {
    type: 'button',
    class: 'icon-btn',
    'aria-label': label,
    'data-ce': ce,
  });
  b.append(icon(doc, ic));
  return b;
}

/** Mode toggles (Element / Text / Region), each with its tooltip. */
export function buildModeBar(
  doc: Document,
  tips: TooltipController,
  offered: readonly CaptureMode[] | undefined,
  toggle: (mode: CaptureMode, wasOn: boolean) => void,
): { bar: HTMLElement; buttons: Map<CaptureMode, HTMLButtonElement> } {
  const bar = el(doc, 'div', { class: 'modes', role: 'group', 'aria-label': 'What to comment on' });
  const buttons = new Map<CaptureMode, HTMLButtonElement>();
  for (const m of MODES.filter((x) => offered?.includes(x.mode) ?? true)) {
    const b = labelledButton(
      doc,
      m.label,
      { class: 'mode', 'data-ce': `mode-${m.mode}`, 'aria-pressed': 'false' },
      m.icon,
    );
    b.addEventListener('click', () => toggle(m.mode, b.getAttribute('aria-pressed') === 'true'));
    tips.attach(b, { text: m.tip, shortcut: 'Esc' });
    buttons.set(m.mode, b);
    bar.append(b);
  }
  return { bar, buttons };
}

/** Send / Copy prompt / Clear. They use `aria-disabled` so tooltips still work while inactive. */
export function buildFooter(
  doc: Document,
  tips: TooltipController,
  mod: string,
  on: { send(): void; copy(): void; clear(): void },
) {
  const send = labelledButton(doc, 'Send', { class: 'primary', 'data-ce': 'send' }, 'send');
  const copy = labelledButton(doc, 'Copy prompt', { 'data-ce': 'copy' });
  const clear = labelledButton(doc, 'Clear', { class: 'danger', 'data-ce': 'clear' });
  const guard = (b: HTMLElement, fn: () => void) =>
    b.addEventListener('click', () => b.getAttribute('aria-disabled') !== 'true' && fn());
  guard(send, on.send);
  guard(copy, on.copy);
  guard(clear, on.clear);
  const sendTip: TooltipHandle = tips.attach(send, {
    text: SEND_TIP_EMPTY,
    shortcut: `${mod}+Enter`,
  });
  tips.attach(copy, {
    text: 'Copy the pending comments as a prompt you can paste into any AI chat.',
  });
  tips.attach(clear, { text: 'Discard all pending comments. Comments already sent are kept.' });
  return { footer: el(doc, 'footer', {}, send, copy, clear), send, copy, clear, sendTip };
}

/** Title row (help, collapse) plus the Claude connection indicator. */
export function buildHeader(
  doc: Document,
  tips: TooltipController,
  on: { help(): void; collapse(): void },
) {
  const agent = el(doc, 'button', { type: 'button', class: 'agent', 'data-ce': 'agent-status' });
  agent.append(
    el(doc, 'span', { class: 'dot', 'aria-hidden': 'true' }),
    el(doc, 'span', { class: 'agent-label' }),
  );
  agent.addEventListener('click', on.help);
  const agentTip = tips.attach(agent, { text: 'Connect Claude' });
  const help = iconButton(doc, 'help', 'How to connect Claude', 'help-open');
  help.addEventListener('click', on.help);
  tips.attach(help, { text: 'How to connect Claude' });
  const collapse = iconButton(doc, 'chevronRight', 'Collapse panel', 'collapse');
  collapse.setAttribute('aria-expanded', 'true');
  collapse.addEventListener('click', on.collapse);
  tips.attach(collapse, { text: 'Collapse to a small handle so the page is not covered.' });
  const header = el(
    doc,
    'header',
    {},
    el(
      doc,
      'div',
      { class: 'title-row' },
      el(doc, 'strong', { text: 'Comment Everything' }),
      help,
      collapse,
    ),
    agent,
  );
  return { header, agent, agentTip, collapse };
}

/** The small tab shown while the panel is collapsed; the badge carries the pending count. */
export function buildHandle(
  doc: Document,
  tips: TooltipController,
  open: () => void,
): HTMLButtonElement {
  const handle = el(doc, 'button', { type: 'button', class: 'handle', 'data-ce': 'handle' });
  handle.append(icon(doc, 'chat'), el(doc, 'span', { class: 'badge', 'aria-hidden': 'true' }));
  handle.addEventListener('click', open);
  tips.attach(handle, { text: 'Open the comment panel.' });
  return handle;
}

/** Status line under the content: message text plus an optional "How to connect" action. */
export function buildToast(doc: Document, onConnect: () => void) {
  const action = labelledButton(doc, 'How to connect', {
    class: 'link',
    'data-ce': 'toast-connect',
  });
  action.hidden = true;
  action.addEventListener('click', onConnect);
  const text = el(doc, 'span', { class: 'toast-text' });
  const toast = el(
    doc,
    'div',
    { class: 'toast', role: 'status', 'data-ce': 'toast' },
    text,
    action,
  );
  return { toast, text, action };
}

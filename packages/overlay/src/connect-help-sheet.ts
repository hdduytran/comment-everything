import { HELP_TABS as DEFAULT_TABS, type HelpTab } from './connect-help-content.js';
import { el } from './dom-helpers.js';
import { icon } from './icons.js';

export interface ConnectHelpSheet {
  readonly root: HTMLElement;
  open(): void;
  /** Returns true when the sheet was open. */
  close(): boolean;
  isOpen(): boolean;
}

/**
 * "Connect to Claude" help, shown inline over the panel body (not a modal): three tabs of
 * short steps with a copy button per command. `copy` writes to the clipboard and rejects on failure.
 */
export function createConnectHelpSheet(
  doc: Document,
  copy: (text: string) => Promise<void>,
  onClose: () => void,
  opts: { tabs?: readonly HelpTab[]; intro?: string } = {},
): ConnectHelpSheet {
  const defs = opts.tabs ?? DEFAULT_TABS;
  const tabs = new Map<HelpTab['id'], { tab: HTMLElement; panel: HTMLElement }>();
  const tablist = el(doc, 'div', {
    class: 'tabs',
    role: 'tablist',
    'aria-label': 'Where Claude runs',
  });
  const panels = el(doc, 'div', { class: 'tab-panels' });

  const select = (id: HelpTab['id'], focus = false) => {
    for (const [key, t] of tabs) {
      const on = key === id;
      t.tab.setAttribute('aria-selected', String(on));
      t.tab.tabIndex = on ? 0 : -1;
      t.panel.hidden = !on;
      if (on && focus) t.tab.focus();
    }
  };

  const commandRow = (command: string) => {
    const code = el(doc, 'code', { text: command });
    const btn = el(doc, 'button', {
      type: 'button',
      class: 'copy-cmd',
      'aria-label': `Copy: ${command}`,
    });
    btn.append(icon(doc, 'copy'));
    btn.addEventListener('click', () => {
      copy(command).then(
        () => flash(btn, 'check'),
        () => flash(btn, 'help'),
      );
    });
    return el(doc, 'div', { class: 'cmd' }, code, btn);
  };
  const flash = (btn: HTMLElement, name: 'check' | 'help') => {
    btn.replaceChildren(icon(doc, name));
    btn.setAttribute('data-state', name === 'check' ? 'copied' : 'failed');
    setTimeout(() => {
      btn.replaceChildren(icon(doc, 'copy'));
      btn.removeAttribute('data-state');
    }, 1500);
  };

  defs.forEach((def, i) => {
    const tab = el(doc, 'button', {
      type: 'button',
      role: 'tab',
      id: `ce-help-tab-${def.id}`,
      'aria-controls': `ce-help-panel-${def.id}`,
      'data-ce': `help-tab-${def.id}`,
      text: def.label,
    });
    const panel = el(doc, 'div', {
      role: 'tabpanel',
      id: `ce-help-panel-${def.id}`,
      'aria-labelledby': tab.id,
      class: 'tab-panel',
    });
    for (const step of def.steps) {
      panel.append(el(doc, 'p', { text: step.text }));
      if (step.command) panel.append(commandRow(step.command));
    }
    tab.addEventListener('click', () => select(def.id));
    tab.addEventListener('keydown', (ev) => {
      const dir = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
      if (!dir) return;
      ev.preventDefault();
      select(defs[(i + dir + defs.length) % defs.length]!.id, true);
    });
    tabs.set(def.id, { tab, panel });
    tablist.append(tab);
    panels.append(panel);
  });

  const back = el(doc, 'button', {
    type: 'button',
    class: 'ghost',
    'data-ce': 'help-close',
    text: 'Back',
  });
  back.addEventListener('click', onClose);
  const root = el(
    doc,
    'section',
    { class: 'help', 'data-ce': 'help', 'aria-label': 'Connect to Claude' },
    el(doc, 'div', { class: 'help-head' }, el(doc, 'h2', { text: 'Connect to Claude' }), back),
    el(doc, 'p', {
      class: 'muted',
      text:
        opts.intro ?? 'Comments are saved either way. Connect Claude so it can read and fix them.',
    }),
    tablist,
    panels,
  );
  root.hidden = true;
  select(defs[0]!.id);

  return {
    root,
    open() {
      root.hidden = false;
      tabs.get(defs[0]!.id)?.tab.focus();
    },
    close() {
      const was = !root.hidden;
      root.hidden = true;
      return was;
    },
    isOpen: () => !root.hidden,
  };
}

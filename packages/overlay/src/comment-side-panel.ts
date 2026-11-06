import { createConnectHelpSheet, type ConnectHelpSheet } from './connect-help-sheet.js';
import { el } from './dom-helpers.js';
import {
  SEND_TIP,
  SEND_TIP_EMPTY,
  buildFooter,
  buildHeader,
  buildHandle,
  buildModeBar,
  buildToast,
} from './panel-chrome.js';
import type { CaptureMode } from './host-adapter.js';
import { createDraftCard, type DraftCard } from './panel-draft-cards.js';
import { SentList } from './panel-sent-list.js';
import type { Draft } from './overlay-state.js';
import type { PanelActions, PanelModel, PanelOptions } from './panel-types.js';
import { TooltipController, modKeyLabel, type TooltipHandle } from './tooltip-controller.js';

export type { PanelActions, PanelModel, PanelOptions } from './panel-types.js';

/** The docked side panel. All agent- and user-authored text is inserted via `textContent`. */
export class SidePanel {
  readonly root: HTMLElement;
  private readonly modeButtons: Map<CaptureMode, HTMLButtonElement>;
  private readonly cards = new Map<string, DraftCard>();
  private readonly areaIds = new WeakMap<Element, string>();
  private readonly tips: TooltipController;
  private readonly sentList: SentList;
  private readonly help: ConnectHelpSheet;
  private readonly refs: Record<string, HTMLElement>;
  private sendTip!: TooltipHandle;
  private agentTip!: TooltipHandle;
  private collapsed = false;

  constructor(
    private readonly doc: Document,
    private readonly actions: PanelActions,
    private readonly options: PanelOptions,
  ) {
    const d = doc;
    const tipLayer = el(d, 'div', { class: 'tips' });
    this.tips = new TooltipController(d, tipLayer);

    const { bar, buttons } = buildModeBar(d, this.tips, options.modes, (mode, wasOn) =>
      actions.setMode(wasOn ? null : mode),
    );
    this.modeButtons = buttons;
    const foot = buildFooter(d, this.tips, modKeyLabel(d.defaultView), actions);
    const head = buildHeader(d, this.tips, {
      help: () => this.openHelp(),
      collapse: () => this.setCollapsed(true),
    });
    this.refs = {
      send: foot.send,
      copy: foot.copy,
      clear: foot.clear,
      agent: head.agent,
      collapse: head.collapse,
    };
    this.sendTip = foot.sendTip;
    this.agentTip = head.agentTip;

    const handle = buildHandle(d, this.tips, () => this.setCollapsed(false));
    const toast = buildToast(d, () => this.openHelp());
    this.refs.handle = handle;
    this.refs.toast = toast.toast;
    this.refs.toastText = toast.text;
    this.refs.toastAction = toast.action;

    this.refs.empty = el(d, 'p', {
      class: 'empty',
      text:
        options.emptyHint ??
        'Nothing pending. Choose Element, Text or Region, then click the page.',
    });
    this.refs.drafts = el(d, 'div', { 'data-ce': 'drafts' });
    this.refs.sentTitle = el(d, 'h3', { text: 'Sent' });
    this.refs.sent = el(d, 'div', { 'data-ce': 'sent' });
    this.sentList = new SentList(d, this.refs.sent, this.tips);
    this.help = createConnectHelpSheet(d, options.copyText, () => this.closeHelp());

    const aside = el(
      d,
      'aside',
      { class: 'panel', 'data-ce': 'panel', 'aria-label': 'Comment Everything' },
      head.header,
      ...(buttons.size > 0 ? [bar] : []),
      el(
        d,
        'div',
        { class: 'body' },
        el(d, 'h3', { text: 'Pending', 'data-ce': 'pending-title' }),
        this.refs.empty,
        this.refs.drafts,
        this.refs.sentTitle,
        this.refs.sent,
      ),
      this.help.root,
      this.refs.toast,
      foot.footer,
    );
    this.root = el(d, 'div', { class: 'shell' }, aside, handle, tipLayer);

    // Delegated through the isolation layer: page listeners never see these keystrokes.
    options.isolation.listen('input', (ev) => {
      const t = ev.composedPath()[0];
      const id = t instanceof Element ? this.areaIds.get(t) : undefined;
      if (id && t instanceof HTMLTextAreaElement) actions.editDraft(id, t.value);
    });
    options.isolation.listen('keydown', (ev) => this.onKeyDown(ev as KeyboardEvent));
  }

  private onKeyDown(ev: KeyboardEvent): void {
    if (ev.isComposing || ev.keyCode === 229) return; // IME: Enter/Esc belong to the composition
    if (ev.key === 'Escape') {
      if (this.tips.hide() || this.closeHelp() || this.actions.cancelMode()) return;
    } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      if (this.refs.send!.getAttribute('aria-disabled') !== 'true') this.actions.send();
    }
  }

  update(model: PanelModel): void {
    for (const [mode, b] of this.modeButtons)
      b.setAttribute('aria-pressed', String(model.mode === mode));
    this.syncDrafts(model.drafts);
    this.sentList.render(model.sent);
    this.refs.sentTitle!.hidden = model.sent.length === 0;
    const n = model.drafts.length;
    const setOn = (key: string, on: boolean) =>
      this.refs[key]!.setAttribute('aria-disabled', String(!on));
    this.refs.send!.querySelector('span')!.textContent = n > 0 ? `Send (${n})` : 'Send';
    setOn('send', n > 0 && !model.busy);
    setOn('copy', n > 0);
    setOn('clear', n > 0 && !model.busy);
    this.sendTip.update({
      text: n > 0 ? SEND_TIP : SEND_TIP_EMPTY,
      shortcut: `${modKeyLabel(this.doc.defaultView)}+Enter`,
    });
    this.refs.handle!.setAttribute(
      'aria-label',
      n > 0 ? `Open comment panel, ${n} pending` : 'Open comment panel',
    );
    this.refs.handle!.querySelector('.badge')!.textContent = n > 0 ? String(n) : '';

    const agent = this.refs.agent!;
    agent.hidden = model.agents === null;
    if (model.agents) {
      agent.dataset.kind = model.agents.kind;
      agent.querySelector('.agent-label')!.textContent = model.agents.label;
      this.agentTip.update({ text: model.agents.tip });
    }
    const m = model.message;
    this.refs.toastText!.textContent = m?.text ?? '';
    this.refs.toastAction!.hidden = m?.action !== 'connect';
    this.refs.toast!.classList.toggle('error', m?.error === true);
    this.refs.toast!.setAttribute('role', m?.error ? 'alert' : 'status');
    this.refs.toast!.hidden = !m;
  }

  dispose(): void {
    this.tips.dispose();
  }

  focusDraft(id: string): void {
    this.setCollapsed(false);
    this.cards.get(id)?.area.focus();
  }

  openHelp(): void {
    this.setCollapsed(false);
    this.help.open();
  }

  private closeHelp(): boolean {
    const was = this.help.close();
    if (was) (this.refs.agent!.hidden ? this.refs.collapse! : this.refs.agent!).focus();
    return was;
  }

  private setCollapsed(collapsed: boolean): void {
    if (collapsed === this.collapsed) return;
    this.collapsed = collapsed;
    this.tips.hide();
    this.root.toggleAttribute('data-collapsed', collapsed);
    this.refs.collapse!.setAttribute('aria-expanded', String(!collapsed));
    this.options.onCollapsedChange?.(collapsed);
    (collapsed ? this.refs.handle! : this.refs.collapse!).focus();
  }

  private syncDrafts(drafts: readonly Draft[]): void {
    this.refs.empty!.hidden = drafts.length > 0;
    const live = new Set(drafts.map((x) => x.id));
    const active = (this.root.getRootNode() as Document | ShadowRoot).activeElement;
    let lostFocus = false;
    for (const [id, c] of this.cards) {
      if (!live.has(id)) {
        lostFocus ||= c.card.contains(active);
        c.card.remove();
        this.cards.delete(id);
      }
    }
    // Removing the focused text box (after Send) would drop focus onto the host page, where
    // keystrokes still in flight (key-up) would reach its shortcuts. Keep focus in the panel.
    if (lostFocus) (this.modeButtons.values().next().value ?? this.refs.collapse!).focus();
    drafts.forEach((draft, i) => {
      let entry = this.cards.get(draft.id);
      if (!entry) {
        entry = createDraftCard(this.doc, draft, this.actions, this.tips);
        this.cards.set(draft.id, entry);
        this.areaIds.set(entry.area, draft.id);
      }
      entry.card.querySelector('.num')!.textContent = String(i + 1);
      // Keep DOM order equal to model order without recreating textareas. Only move a card that
      // is out of place: moving a node blurs it, and a render (e.g. an SSE update) must never
      // pull focus out of the text box being typed in.
      const at = this.refs.drafts!.children[i] ?? null;
      if (at !== entry.card) this.refs.drafts!.insertBefore(entry.card, at);
    });
  }
}

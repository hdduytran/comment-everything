import { describeSelector, type Comment } from '@comment-everything/core/browser';
import { el } from './dom-helpers.js';
import type { CaptureMode } from './host-adapter.js';
import type { Draft } from './overlay-state.js';

export interface PanelModel {
  mode: CaptureMode | null;
  drafts: readonly Draft[];
  sent: readonly Comment[];
  busy: boolean;
  message: { text: string; error: boolean } | null;
}

export interface PanelActions {
  setMode(mode: CaptureMode | null): void;
  editDraft(id: string, text: string): void;
  removeDraft(id: string): void;
  focusDraft(id: string): void;
  send(): void;
  copy(): void;
  clear(): void;
}

const MODES: { mode: CaptureMode; label: string; title: string }[] = [
  { mode: 'element', label: 'Element', title: 'Pick an element' },
  { mode: 'text', label: 'Text', title: 'Select text' },
  { mode: 'region', label: 'Region', title: 'Drag a screenshot region' },
];
const STATUS_LABEL: Record<Comment['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
};
const MAX_SENT_SHOWN = 50;

/** The docked side panel. All agent- and user-authored text is inserted via `textContent`. */
export class SidePanel {
  readonly root: HTMLElement;
  private readonly modeButtons = new Map<CaptureMode, HTMLButtonElement>();
  private readonly cards = new Map<string, { card: HTMLElement; area: HTMLTextAreaElement }>();
  private readonly draftsEl: HTMLElement;
  private readonly emptyEl: HTMLElement;
  private readonly sentEl: HTMLElement;
  private readonly sentTitle: HTMLElement;
  private readonly sendBtn: HTMLButtonElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly toast: HTMLElement;

  constructor(
    private readonly doc: Document,
    private readonly actions: PanelActions,
  ) {
    const d = doc;
    const button = (text: string, attrs: Record<string, string>) =>
      el(d, 'button', { text, type: 'button', ...attrs });
    const modes = el(d, 'div', { class: 'modes' });
    for (const m of MODES) {
      const b = button(m.label, { title: m.title, 'data-ce': `mode-${m.mode}` });
      b.addEventListener('click', () =>
        actions.setMode(b.classList.contains('active') ? null : m.mode),
      );
      this.modeButtons.set(m.mode, b);
      modes.append(b);
    }
    this.draftsEl = el(d, 'div', { 'data-ce': 'drafts' });
    this.emptyEl = el(d, 'p', {
      class: 'empty',
      text: 'Pick an element, select text or drag a region, then write your comment.',
    });
    this.sentEl = el(d, 'div', { 'data-ce': 'sent' });
    this.sentTitle = el(d, 'h3', { text: 'Sent' });
    this.sendBtn = button('Send', { class: 'primary', 'data-ce': 'send' });
    this.copyBtn = button('Copy prompt', { 'data-ce': 'copy' });
    this.clearBtn = button('Clear', { class: 'danger', 'data-ce': 'clear' });
    this.sendBtn.addEventListener('click', actions.send);
    this.copyBtn.addEventListener('click', actions.copy);
    this.clearBtn.addEventListener('click', actions.clear);
    this.toast = el(d, 'div', { class: 'toast', role: 'status', 'data-ce': 'toast' });

    this.root = el(
      d,
      'aside',
      { class: 'panel', 'data-ce': 'panel' },
      el(d, 'header', {}, el(d, 'strong', { text: 'Comment Everything' })),
      modes,
      el(
        d,
        'div',
        { class: 'body' },
        el(d, 'h3', { text: 'Pending', 'data-ce': 'pending-title' }),
        this.emptyEl,
        this.draftsEl,
        this.sentTitle,
        this.sentEl,
      ),
      this.toast,
      el(d, 'footer', {}, this.sendBtn, this.copyBtn, this.clearBtn),
    );
  }

  update(model: PanelModel): void {
    for (const [mode, b] of this.modeButtons) b.classList.toggle('active', model.mode === mode);
    this.syncDrafts(model.drafts);
    this.syncSent(model.sent);
    const n = model.drafts.length;
    this.sendBtn.textContent = n > 0 ? `Send (${n})` : 'Send';
    this.sendBtn.disabled = n === 0 || model.busy;
    this.copyBtn.disabled = n === 0;
    this.clearBtn.disabled = n === 0 || model.busy;
    this.toast.textContent = model.message?.text ?? '';
    this.toast.classList.toggle('error', model.message?.error === true);
  }

  focusDraft(id: string): void {
    this.cards.get(id)?.area.focus();
  }

  private syncDrafts(drafts: readonly Draft[]): void {
    this.emptyEl.style.display = drafts.length === 0 ? 'block' : 'none';
    const live = new Set(drafts.map((x) => x.id));
    for (const [id, c] of this.cards) {
      if (!live.has(id)) {
        c.card.remove();
        this.cards.delete(id);
      }
    }
    drafts.forEach((draft, i) => {
      const entry = this.cards.get(draft.id) ?? this.createCard(draft);
      entry.card.querySelector('.num')!.textContent = String(i + 1);
      // Re-append keeps DOM order equal to model order without recreating textareas.
      this.draftsEl.append(entry.card);
    });
  }

  private createCard(draft: Draft): { card: HTMLElement; area: HTMLTextAreaElement } {
    const d = this.doc;
    const area = el(d, 'textarea', {
      placeholder: 'Write your comment…',
      'data-ce': 'draft-text',
      'aria-label': 'Comment text',
    });
    area.value = draft.text;
    area.addEventListener('input', () => this.actions.editDraft(draft.id, area.value));
    area.addEventListener('focus', () => this.actions.focusDraft(draft.id));
    const remove = el(d, 'button', { class: 'x', text: '×', title: 'Remove', type: 'button' });
    remove.addEventListener('click', () => this.actions.removeDraft(draft.id));
    const card = el(
      d,
      'div',
      { class: 'card', 'data-ce': 'draft' },
      el(
        d,
        'div',
        { class: 'row' },
        el(d, 'span', { class: 'num' }),
        el(d, 'span', { class: 'label', text: draft.label, title: draft.label }),
        remove,
      ),
      area,
    );
    const entry = { card, area };
    this.cards.set(draft.id, entry);
    return entry;
  }

  private syncSent(sent: readonly Comment[]): void {
    this.sentTitle.style.display = sent.length === 0 ? 'none' : 'block';
    const shown = [...sent]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_SENT_SHOWN);
    this.sentEl.replaceChildren(
      ...shown.map((c) => {
        const d = this.doc;
        const where = c.selectors[0] ? describeSelector(c.selectors[0]) : c.source;
        return el(
          d,
          'div',
          {
            class: `sent ${c.status}${c.anchorState === 'orphaned' ? ' detached' : ''}`,
            'data-ce': 'sent-item',
            'data-status': c.status,
            ...(c.anchorState ? { 'data-anchor': c.anchorState } : {}),
          },
          el(d, 'span', { class: 'chip', text: STATUS_LABEL[c.status] }),
          ...(c.anchorState === 'orphaned'
            ? [
                el(d, 'span', {
                  class: 'chip detached-chip',
                  text: 'Detached',
                  title: 'The commented content no longer exists in the file',
                  'data-ce': 'detached',
                }),
              ]
            : []),
          el(d, 'span', { class: 'where', text: ` ${where}` }),
          el(d, 'div', { class: 'text', text: c.text }),
          ...(c.resolution
            ? [el(d, 'div', { class: 'note', text: `Agent: ${c.resolution}`, 'data-ce': 'note' })]
            : []),
        );
      }),
    );
  }
}

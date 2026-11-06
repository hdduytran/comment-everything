import {
  describeSelector,
  type Comment,
  type CommentStatus,
} from '@comment-everything/core/browser';
import { el } from './dom-helpers.js';
import { icon } from './icons.js';
import type { TooltipController, TooltipHandle } from './tooltip-controller.js';

const STATUS_LABEL: Record<Comment['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
};
const STATUS_TIP: Record<Comment['status'], string> = {
  open: 'Saved, not picked up yet. Claude marks it in progress when it starts.',
  in_progress: 'Claude is working on this comment.',
  resolved: 'Claude finished this comment. Its note is shown below.',
};
/** Tips when the user owns the status (no agent resolves comments). */
const LOCAL_TIP: Record<Comment['status'], string> = {
  open: 'Saved in this browser. Mark it resolved when it is done.',
  in_progress: 'Marked in progress.',
  resolved: 'You marked this comment resolved.',
};
const MAX_SENT_SHOWN = 50;

/** Present when the transport lets the user edit saved comments (standalone hosts). */
export interface SentActions {
  setStatus(id: string, status: CommentStatus): void;
  remove(id: string): void;
}

/** The "Sent" list; chips carry tooltips, so each re-render releases the previous ones. */
export class SentList {
  private tipHandles: TooltipHandle[] = [];

  constructor(
    private readonly doc: Document,
    private readonly container: HTMLElement,
    private readonly tips: TooltipController,
    private readonly actions?: SentActions,
  ) {}

  render(sent: readonly Comment[]): void {
    this.tipHandles.forEach((h) => h.detach());
    this.tipHandles = [];
    const shown = [...sent]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_SENT_SHOWN);
    this.container.replaceChildren(...shown.map((c) => this.item(c)));
  }

  /** A chip is focusable so keyboard users can read its tooltip too. */
  private chip(text: string, tip: string, cls: string, ce?: string): HTMLElement {
    const chip = el(this.doc, 'span', { class: `chip ${cls}`, text, tabindex: '0', 'data-ce': ce });
    this.tipHandles.push(this.tips.attach(chip, { text: tip }));
    return chip;
  }

  private item(c: Comment): HTMLElement {
    const d = this.doc;
    const where = c.selectors[0] ? describeSelector(c.selectors[0]) : c.source;
    const detached = c.anchorState === 'orphaned';
    return el(
      d,
      'div',
      {
        class: `sent ${c.status}${detached ? ' detached' : ''}`,
        'data-ce': 'sent-item',
        'data-status': c.status,
        ...(c.anchorState ? { 'data-anchor': c.anchorState } : {}),
      },
      el(
        d,
        'div',
        { class: 'row' },
        this.chip(
          STATUS_LABEL[c.status],
          (this.actions ? LOCAL_TIP : STATUS_TIP)[c.status],
          `chip-${c.status}`,
        ),
        ...(detached
          ? [
              this.chip(
                'Detached',
                'The commented content no longer exists in the file, so this comment has no place to point at.',
                'chip-detached',
                'detached',
              ),
            ]
          : []),
        el(d, 'span', { class: 'where', text: where, title: where }),
      ),
      el(d, 'div', { class: 'text', text: c.text }),
      ...(c.resolution
        ? [el(d, 'div', { class: 'note', text: `Agent: ${c.resolution}`, 'data-ce': 'note' })]
        : []),
      ...(this.actions ? [this.controls(c)] : []),
    );
  }

  /** Resolve / reopen and delete, for comments the user owns. */
  private controls(c: Comment): HTMLElement {
    const d = this.doc;
    const done = c.status === 'resolved';
    const toggle = el(d, 'button', { type: 'button', class: 'ghost', 'data-ce': 'sent-resolve' });
    toggle.append(icon(d, 'check'), el(d, 'span', { text: done ? 'Reopen' : 'Mark resolved' }));
    toggle.addEventListener('click', () =>
      this.actions?.setStatus(c.id, done ? 'open' : 'resolved'),
    );
    const remove = el(d, 'button', {
      type: 'button',
      class: 'ghost',
      'aria-label': 'Delete this saved comment',
      'data-ce': 'sent-delete',
    });
    remove.append(icon(d, 'trash'));
    remove.addEventListener('click', () => this.actions?.remove(c.id));
    this.tipHandles.push(
      this.tips.attach(toggle, {
        text: done ? 'Mark this comment open again.' : 'Mark this comment as done.',
      }),
      this.tips.attach(remove, { text: 'Delete this saved comment from this browser.' }),
    );
    return el(d, 'div', { class: 'row sent-actions' }, toggle, remove);
  }
}

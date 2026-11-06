import { describeSelector, type Comment } from '@comment-everything/core/browser';
import { el } from './dom-helpers.js';
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
const MAX_SENT_SHOWN = 50;

/** The "Sent" list; chips carry tooltips, so each re-render releases the previous ones. */
export class SentList {
  private tipHandles: TooltipHandle[] = [];

  constructor(
    private readonly doc: Document,
    private readonly container: HTMLElement,
    private readonly tips: TooltipController,
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
        this.chip(STATUS_LABEL[c.status], STATUS_TIP[c.status], `chip-${c.status}`),
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
    );
  }
}

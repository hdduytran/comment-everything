import { el } from './dom-helpers.js';
import { icon } from './icons.js';
import type { Draft } from './overlay-state.js';
import type { TooltipController } from './tooltip-controller.js';

export interface DraftCard {
  card: HTMLElement;
  area: HTMLTextAreaElement;
}

export interface DraftCardActions {
  focusDraft(id: string): void;
  removeDraft(id: string): void;
}

/**
 * One pending comment: numbered pin badge, what was picked, a remove button and the text box.
 * The text box's `input` is wired by the panel (through event isolation), not here.
 */
export function createDraftCard(
  doc: Document,
  draft: Draft,
  actions: DraftCardActions,
  tips: TooltipController,
): DraftCard {
  const area = el(doc, 'textarea', {
    placeholder: 'What should change?',
    'data-ce': 'draft-text',
    'aria-label': 'Comment text',
    rows: '3',
  });
  area.value = draft.text;
  area.addEventListener('focus', () => actions.focusDraft(draft.id));

  const remove = el(doc, 'button', {
    class: 'icon-btn',
    type: 'button',
    'aria-label': 'Remove this comment',
    'data-ce': 'draft-remove',
  });
  remove.append(icon(doc, 'close'));
  remove.addEventListener('click', () => actions.removeDraft(draft.id));
  tips.attach(remove, { text: 'Remove this pending comment' });

  const card = el(
    doc,
    'div',
    { class: 'card', 'data-ce': 'draft' },
    el(
      doc,
      'div',
      { class: 'row' },
      el(doc, 'span', { class: 'num' }),
      el(doc, 'span', { class: 'label', text: draft.label, title: draft.label }),
      remove,
    ),
    area,
  );
  return { card, area };
}

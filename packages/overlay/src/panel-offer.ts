import { el } from './dom-helpers.js';
import type { OverlayOffer } from './host-adapter.js';
import type { TooltipController } from './tooltip-controller.js';

/**
 * A one-time call to action above the footer, e.g. "3 comments saved in this browser" with a
 * "Move to project" button. It is hidden until the host passes an offer and after it succeeds.
 */
export function buildOffer(
  doc: Document,
  tips: TooltipController,
  offer: OverlayOffer,
  run: () => void,
) {
  const button = el(doc, 'button', { type: 'button', class: 'primary', 'data-ce': 'offer-run' });
  button.append(el(doc, 'span', { text: offer.actionLabel }));
  button.addEventListener('click', () => button.getAttribute('aria-disabled') !== 'true' && run());
  tips.attach(button, { text: offer.actionTip });
  const root = el(
    doc,
    'div',
    { class: 'offer', role: 'region', 'aria-label': 'Local comments', 'data-ce': 'offer' },
    el(doc, 'span', { class: 'offer-text', text: offer.text }),
    button,
  );
  return { root, button };
}

import { labelledButton } from './panel-chrome.js';
import { el } from './dom-helpers.js';
import type { PanelModel } from './panel-types.js';
import type { TooltipController, TooltipHandle } from './tooltip-controller.js';

/**
 * Status line under the content: message text plus an optional "How to connect" action and an
 * optional "Copy" button for a sentence the user should paste somewhere (an agent prompt).
 */
export class PanelToast {
  readonly root: HTMLElement;
  private readonly text: HTMLElement;
  private readonly connect: HTMLElement;
  private readonly copy: HTMLElement;
  private readonly copyTip: TooltipHandle;
  private copyValue = '';

  constructor(
    doc: Document,
    tips: TooltipController,
    private readonly writeClipboard: (text: string) => Promise<void>,
    onConnect: () => void,
  ) {
    this.text = el(doc, 'span', { class: 'toast-text' });
    this.connect = labelledButton(doc, 'How to connect', {
      class: 'link',
      'data-ce': 'toast-connect',
    });
    this.connect.hidden = true;
    this.connect.addEventListener('click', onConnect);
    this.copy = labelledButton(doc, 'Copy', { class: 'link', 'data-ce': 'toast-copy' }, 'copy');
    this.copy.hidden = true;
    this.copy.addEventListener('click', () => this.copyValueToClipboard());
    this.copyTip = tips.attach(this.copy, { text: 'Copy to the clipboard.' });
    this.root = el(
      doc,
      'div',
      { class: 'toast', role: 'status', 'data-ce': 'toast' },
      this.text,
      this.connect,
      this.copy,
    );
  }

  update(m: PanelModel['message']): void {
    this.text.textContent = m?.text ?? '';
    this.connect.hidden = m?.action !== 'connect';
    this.copy.hidden = !m?.copy;
    if (m?.copy) {
      this.copyValue = m.copy.text;
      this.copyTip.update({ text: m.copy.tip });
    }
    this.root.classList.toggle('error', m?.error === true);
    this.root.setAttribute('role', m?.error ? 'alert' : 'status');
    this.root.hidden = !m;
  }

  private copyValueToClipboard(): void {
    const label = this.copy.querySelector('span')!;
    this.writeClipboard(this.copyValue).then(
      () => (label.textContent = 'Copied'),
      () => (label.textContent = 'Copy failed'),
    );
    setTimeout(() => (label.textContent = 'Copy'), 1500);
  }
}

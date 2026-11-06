import { createShadowHost, el } from './dom-helpers.js';
import type { PinSpec } from './host-adapter.js';
import { rectsOf, type Anchorable } from './selector-resolver.js';

const PIN_CSS = `
:host{all:initial}
.pin{position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:#2563eb;color:#fff;
  font:600 12px/22px system-ui,sans-serif;text-align:center;cursor:pointer;pointer-events:auto;border:2px solid #fff;
  box-shadow:0 1px 4px rgba(0,0,0,.4);padding:0;box-sizing:content-box}
.pin.flash{animation:flash .9s ease-out 1}
.mark{position:absolute;pointer-events:none;background:rgba(37,99,235,.18);outline:1px solid rgba(37,99,235,.7)}
@keyframes flash{0%{transform:scale(2.2)}100%{transform:scale(1)}}`;

export type TargetResolver = (selectors: PinSpec['selectors']) => Anchorable | null;

/**
 * Numbered pins and highlight boxes drawn inside a document, positioned in document
 * coordinates so they scroll with the content. Selectors are re-resolved on every reposition,
 * so pins follow the content after layout changes or a reload.
 */
export class PinLayer {
  private readonly host: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly win: Window;
  private readonly resizeObserver: ResizeObserver;
  private pins: PinSpec[] = [];
  private frame = 0;

  constructor(
    private readonly doc: Document,
    private readonly resolve: TargetResolver,
    private readonly onPinClick: (id: string) => void,
  ) {
    const created = createShadowHost(
      doc,
      doc.documentElement,
      PIN_CSS,
      'position:absolute;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483646',
    );
    this.host = created.host;
    this.layer = el(doc, 'div');
    created.shadow.append(this.layer);
    this.win = doc.defaultView as Window;
    this.resizeObserver = new ResizeObserver(() => this.schedule());
    this.resizeObserver.observe(doc.documentElement);
    this.win.addEventListener('resize', this.schedule);
    this.win.addEventListener('load', this.schedule);
  }

  private readonly schedule = (): void => {
    if (this.frame) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  };

  setPins(pins: PinSpec[]): void {
    this.pins = pins;
    this.render();
  }

  /** Redraw every pin from its selectors. Pins whose target cannot be found are not drawn. */
  render(): void {
    this.layer.replaceChildren();
    for (const pin of this.pins) {
      const target = this.resolve(pin.selectors);
      if (!target) continue;
      const rects = rectsOf(target);
      for (const r of rects) {
        const mark = el(this.doc, 'div', { class: 'mark' });
        Object.assign(mark.style, {
          left: `${r.left + this.win.scrollX}px`,
          top: `${r.top + this.win.scrollY}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
        });
        this.layer.append(mark);
      }
      const first = rects[0];
      if (!first) continue;
      const btn = el(this.doc, 'button', {
        class: 'pin',
        text: String(pin.n),
        'data-pin': pin.id,
        'data-testid': `ce-pin-${pin.n}`,
        'aria-label': `Comment ${pin.n}`,
      });
      btn.style.left = `${Math.max(11, first.left + this.win.scrollX)}px`;
      btn.style.top = `${Math.max(11, first.top + this.win.scrollY)}px`;
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.onPinClick(pin.id);
      });
      this.layer.append(btn);
    }
  }

  focus(id: string): void {
    const btn = this.layer.querySelector<HTMLElement>(`[data-pin="${CSS.escape(id)}"]`);
    if (!btn) return;
    btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
    btn.classList.remove('flash');
    void btn.offsetWidth; // restart the animation
    btn.classList.add('flash');
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.win.removeEventListener('resize', this.schedule);
    this.win.removeEventListener('load', this.schedule);
    if (this.frame) this.win.cancelAnimationFrame(this.frame);
    this.host.remove();
  }
}

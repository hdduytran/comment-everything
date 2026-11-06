import { el } from './dom-helpers.js';

export interface TooltipSpec {
  text: string;
  /** Shown as key caps after the text, e.g. `Esc` or `Ctrl+Enter`. */
  shortcut?: string;
}

export interface TooltipHandle {
  update(spec: TooltipSpec): void;
  /** Remove the tooltip and its listeners (for controls that are about to be re-rendered). */
  detach(): void;
}

export const TOOLTIP_DELAY_MS = 400;
const GAP_PX = 6;
const EDGE_PX = 8;
let uid = 0;

/**
 * Accessible tooltips for controls inside one tree (a shadow root or a document body).
 * Each target gets its own `role=tooltip` element referenced by `aria-describedby`, so the text is
 * always available to assistive tech; sighted users see it after a short delay on hover or
 * keyboard focus. Tooltips are `position:fixed` in `layer`, so no `overflow` ancestor clips them.
 * Text is always written with `textContent`.
 */
export class TooltipController {
  private shown: { tip: HTMLElement; target: HTMLElement } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly handles = new Set<TooltipHandle>();
  private readonly stopEsc: () => void;

  constructor(
    private readonly doc: Document,
    private readonly layer: HTMLElement,
    private readonly delayMs: number = TOOLTIP_DELAY_MS,
  ) {
    // Esc dismisses a tooltip without moving the pointer or focus (WCAG 1.4.13). Keys typed inside
    // the overlay are routed here by the panel's own handler; this covers the host page.
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && this.hide();
    const win = doc.defaultView;
    win?.addEventListener('keydown', onEsc, true);
    this.stopEsc = () => win?.removeEventListener('keydown', onEsc, true);
  }

  /** Describe `target` with a tooltip. */
  attach(target: HTMLElement, spec: TooltipSpec): TooltipHandle {
    const tip = el(this.doc, 'div', { class: 'tip', role: 'tooltip', id: `ce-tip-${++uid}` });
    tip.hidden = true;
    this.layer.append(tip);
    target.setAttribute('aria-describedby', tip.id);
    const fill = (s: TooltipSpec) => {
      tip.replaceChildren(el(this.doc, 'span', { text: s.text }));
      if (s.shortcut) tip.append(el(this.doc, 'kbd', { text: s.shortcut }));
    };
    fill(spec);

    let byPointer = false;
    const schedule = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.show(tip, target), this.delayMs);
    };
    const hide = () => {
      byPointer = false;
      this.hide();
    };
    const offs: (() => void)[] = [];
    const on = (type: string, fn: () => void) => {
      target.addEventListener(type, fn);
      offs.push(() => target.removeEventListener(type, fn));
    };
    on('mouseenter', schedule);
    on('mouseleave', hide);
    on('pointerdown', () => {
      byPointer = true; // a click focuses the control; that focus must not pop a tooltip
      this.hide();
    });
    on('focus', () => {
      if (!byPointer) schedule();
    });
    on('blur', hide);
    const handle: TooltipHandle = {
      update: fill,
      detach: () => {
        if (this.shown?.tip === tip) this.hide();
        offs.forEach((off) => off());
        target.removeAttribute('aria-describedby');
        tip.remove();
        this.handles.delete(handle);
      },
    };
    this.handles.add(handle);
    return handle;
  }

  /** Hide the tooltip and cancel a pending one (Esc). Returns true only if one was visible. */
  hide(): boolean {
    const had = this.shown !== null;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.shown) this.shown.tip.hidden = true;
    this.shown = null;
    return had;
  }

  dispose(): void {
    this.stopEsc();
    this.hide();
    [...this.handles].forEach((h) => h.detach());
  }

  private show(tip: HTMLElement, target: HTMLElement): void {
    this.timer = undefined;
    if (!target.isConnected) return;
    if (this.shown) this.shown.tip.hidden = true;
    tip.hidden = false;
    this.shown = { tip, target };
    const win = this.doc.defaultView as Window;
    const r = target.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const left = Math.min(
      Math.max(EDGE_PX, r.left + r.width / 2 - t.width / 2),
      win.innerWidth - t.width - EDGE_PX,
    );
    const below = r.bottom + GAP_PX + t.height <= win.innerHeight - EDGE_PX;
    const top = below ? r.bottom + GAP_PX : Math.max(EDGE_PX, r.top - GAP_PX - t.height);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }
}

/** `Cmd` on Apple platforms, `Ctrl` elsewhere, for shortcut hints. */
export function modKeyLabel(win: Window | null | undefined): string {
  return /mac|iphone|ipad/i.test(win?.navigator?.platform ?? '') ? '⌘' : 'Ctrl';
}

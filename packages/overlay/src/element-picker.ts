import { createShadowHost, el, isOverlayNode } from './dom-helpers.js';

const PICKER_CSS = `.box{position:fixed;pointer-events:none;border:2px solid #2563eb;background:rgba(37,99,235,.12);border-radius:2px;display:none;box-sizing:border-box}`;

export interface PickerCallbacks {
  onPick(element: Element): void;
  onCancel(): void;
}

/**
 * Element-pick mode: hovering outlines the element under the cursor, a click selects it
 * (the click is swallowed so links and buttons on the page do not fire). Esc cancels.
 * Returns a function that stops the mode and removes its UI.
 */
export function startElementPicker(doc: Document, cb: PickerCallbacks): () => void {
  const { host, shadow } = createShadowHost(doc, doc.documentElement, PICKER_CSS);
  const box = el(doc, 'div', { class: 'box' });
  shadow.append(box);
  const win = doc.defaultView as Window;

  const hide = () => {
    box.style.display = 'none';
  };
  const targetAt = (ev: MouseEvent): Element | null => {
    const t = ev.target instanceof Element ? ev.target : null;
    return t && !isOverlayNode(t) && t !== doc.documentElement ? t : null;
  };

  const onMove = (ev: MouseEvent) => {
    const t = targetAt(ev);
    if (!t) return hide();
    const r = t.getBoundingClientRect();
    Object.assign(box.style, {
      display: 'block',
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  };
  const swallow = (ev: Event) => {
    if (isOverlayNode(ev.target)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  };
  const onClick = (ev: MouseEvent) => {
    const t = targetAt(ev);
    swallow(ev);
    if (t) cb.onPick(t);
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') cb.onCancel();
  };

  doc.addEventListener('mousemove', onMove, true);
  doc.addEventListener('click', onClick, true);
  for (const type of ['mousedown', 'mouseup', 'auxclick', 'submit'] as const) {
    doc.addEventListener(type, swallow, true);
  }
  doc.addEventListener('keydown', onKey, true);
  win.addEventListener('scroll', hide, true);

  return () => {
    doc.removeEventListener('mousemove', onMove, true);
    doc.removeEventListener('click', onClick, true);
    for (const type of ['mousedown', 'mouseup', 'auxclick', 'submit'] as const) {
      doc.removeEventListener(type, swallow, true);
    }
    doc.removeEventListener('keydown', onKey, true);
    win.removeEventListener('scroll', hide, true);
    host.remove();
  };
}

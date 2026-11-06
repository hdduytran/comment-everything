import { HOST_ATTR, type Rect } from '@comment-everything/overlay';

const MIN_SIDE = 8;

const CSS = `
.catcher{position:fixed;inset:0;cursor:crosshair;background:rgba(15,23,42,.08)}
.sel{position:fixed;border:2px dashed #2563eb;background:rgba(37,99,235,.15);box-sizing:border-box;display:none}`;

export interface ViewportRegionCallbacks {
  /** Rectangle in viewport (CSS pixel) coordinates. */
  onRegion(rect: Rect): void;
  onCancel(): void;
}

/** Drag-a-rectangle mode over the visible viewport. Returns a function that stops it. */
export function startViewportRegionSelect(doc: Document, cb: ViewportRegionCallbacks): () => void {
  const host = doc.createElement('div');
  host.setAttribute(HOST_ATTR, '');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const catcher = doc.createElement('div');
  catcher.className = 'catcher';
  const sel = doc.createElement('div');
  sel.className = 'sel';
  shadow.append(style, catcher, sel);
  doc.documentElement.append(host);

  let origin: { x: number; y: number } | null = null;
  const rectTo = (x: number, y: number): Rect => ({
    x: Math.min(origin?.x ?? x, x),
    y: Math.min(origin?.y ?? y, y),
    width: Math.abs(x - (origin?.x ?? x)),
    height: Math.abs(y - (origin?.y ?? y)),
  });

  catcher.addEventListener('pointerdown', (ev) => {
    origin = { x: ev.clientX, y: ev.clientY };
    catcher.setPointerCapture(ev.pointerId);
    sel.style.display = 'block';
  });
  catcher.addEventListener('pointermove', (ev) => {
    if (!origin) return;
    const r = rectTo(ev.clientX, ev.clientY);
    Object.assign(sel.style, {
      left: `${r.x}px`,
      top: `${r.y}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  });
  catcher.addEventListener('pointerup', (ev) => {
    if (!origin) return;
    const r = rectTo(ev.clientX, ev.clientY);
    origin = null;
    sel.style.display = 'none';
    if (r.width >= MIN_SIDE && r.height >= MIN_SIDE) cb.onRegion(r);
  });
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') cb.onCancel();
  };
  doc.addEventListener('keydown', onKey, true);
  return () => {
    doc.removeEventListener('keydown', onKey, true);
    host.remove();
  };
}

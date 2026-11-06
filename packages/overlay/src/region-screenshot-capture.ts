import { toCanvas } from 'html-to-image';
import { HOST_ATTR, createShadowHost, el } from './dom-helpers.js';
import type { Rect } from './host-adapter.js';

const REGION_CSS = `
.catcher{position:fixed;inset:0;cursor:crosshair;background:rgba(15,23,42,.08);z-index:1}
.sel{position:fixed;border:2px dashed #2563eb;background:rgba(37,99,235,.15);box-sizing:border-box;display:none}`;

const MIN_SIDE = 8;
const MAX_SIDE = 4000;

export interface RegionCallbacks {
  /** Rectangle in document coordinates (viewport + scroll). */
  onRegion(rect: Rect): void;
  onCancel(): void;
}

/** Region mode: drag a rectangle over the content. Returns a function that stops the mode. */
export function startRegionSelect(doc: Document, cb: RegionCallbacks): () => void {
  const { host, shadow } = createShadowHost(doc, doc.documentElement, REGION_CSS);
  const catcher = el(doc, 'div', { class: 'catcher' });
  const sel = el(doc, 'div', { class: 'sel' });
  shadow.append(catcher, sel);
  const win = doc.defaultView as Window;
  let origin: { x: number; y: number } | null = null;

  const rectTo = (x: number, y: number) => ({
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
    if (r.width < MIN_SIDE || r.height < MIN_SIDE) return;
    cb.onRegion({
      x: Math.round(r.x + win.scrollX),
      y: Math.round(r.y + win.scrollY),
      width: Math.round(Math.min(r.width, MAX_SIDE)),
      height: Math.round(Math.min(r.height, MAX_SIDE)),
    });
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

/** Background to paint behind a capture so transparent pages do not come out black. */
function backgroundOf(root: HTMLElement): string {
  const win = root.ownerDocument.defaultView as Window;
  for (const node of [root, root.ownerDocument.documentElement]) {
    const bg = win.getComputedStyle(node).backgroundColor;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
  }
  return '#ffffff';
}

/**
 * Render `docRect` (document coordinates) of the content under `root` to a PNG. The root is
 * serialized into an SVG foreignObject (html-to-image), shifted so the region sits at the origin.
 */
export async function renderRegionPng(root: HTMLElement, docRect: Rect): Promise<Blob> {
  const win = root.ownerDocument.defaultView as Window;
  const box = root.getBoundingClientRect();
  const localX = docRect.x - (box.left + win.scrollX);
  const localY = docRect.y - (box.top + win.scrollY);
  const canvas = await toCanvas(root, {
    width: docRect.width,
    height: docRect.height,
    pixelRatio: Math.min(win.devicePixelRatio || 1, 2),
    backgroundColor: backgroundOf(root),
    // Keep the clone laid out at its real size; only the visible window is cropped.
    style: {
      margin: '0',
      width: `${box.width}px`,
      height: `${Math.max(root.scrollHeight, box.height)}px`,
      transform: `translate(${-localX}px, ${-localY}px)`,
      transformOrigin: 'top left',
    },
    filter: (node) => !(node instanceof Element && node.hasAttribute(HOST_ATTR)),
  });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode screenshot'))),
      'image/png',
    ),
  );
}

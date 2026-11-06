import {
  HOST_ATTR,
  type Anchor,
  type CaptureMode,
  type ContentAdapter,
  type PinSpec,
  type Rect,
  type Unsubscribe,
} from '@comment-everything/overlay';
import { base64ToBytes } from './base64-bytes.js';
import { askWorker } from './content-proxy-transport.js';
import type { CaptureReply } from './extension-messages.js';
import { startViewportRegionSelect } from './viewport-region-select.js';

/** Crop a `captureVisibleTab` data URL (device pixels) to a viewport rectangle (CSS pixels). */
export async function cropCapture(
  dataUrl: string,
  rect: Rect,
  viewportWidth: number,
): Promise<Blob> {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bitmap = await createImageBitmap(new Blob([base64ToBytes(base64)], { type: 'image/png' }));
  const scale = bitmap.width / viewportWidth;
  const sx = Math.round(rect.x * scale);
  const sy = Math.round(rect.y * scale);
  const sw = Math.max(1, Math.min(Math.round(rect.width * scale), bitmap.width - sx));
  const sh = Math.max(1, Math.min(Math.round(rect.height * scale), bitmap.height - sy));
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/png' });
}

const nextFrame = (win: Window) => new Promise<void>((r) => win.requestAnimationFrame(() => r()));

/** Grab the visible tab with the overlay hidden so panel and pins are not in the screenshot. */
async function captureWithoutOverlay(doc: Document): Promise<string> {
  const win = doc.defaultView as Window;
  const hosts = [...doc.querySelectorAll<HTMLElement>(`[${HOST_ATTR}]`)];
  const previous = hosts.map((h) => h.style.visibility);
  hosts.forEach((h) => (h.style.visibility = 'hidden'));
  try {
    await nextFrame(win);
    await nextFrame(win);
    const reply = await askWorker<CaptureReply>({ type: 'ce:capture' });
    if (!reply.ok) throw new Error(reply.error);
    return reply.dataUrl;
  } finally {
    hosts.forEach((h, i) => (h.style.visibility = previous[i] ?? ''));
  }
}

/**
 * Wraps the in-page adapter: element/text capture and pins stay with it, while region mode is
 * replaced by a viewport drag whose screenshot comes from `chrome.tabs.captureVisibleTab`
 * (pixel-accurate, unlike re-rendering the DOM).
 */
export function createTabScreenshotAdapter(
  inner: ContentAdapter,
  opts: { doc?: Document; onError?(error: Error): void } = {},
): ContentAdapter {
  const doc = opts.doc ?? document;
  const win = doc.defaultView as Window;
  const anchors = new Set<(a: Anchor) => void>();
  const cancels = new Set<() => void>();
  const subscriptions: Unsubscribe[] = [
    inner.onAnchor((a) => anchors.forEach((cb) => cb(a))),
    inner.onCancel(() => cancels.forEach((cb) => cb())),
  ];
  let stopRegion: (() => void) | null = null;

  const capture = async (viewportRect: Rect) => {
    const dataUrl = await captureWithoutOverlay(doc);
    const png = await cropCapture(dataUrl, viewportRect, win.innerWidth);
    const rect: Rect = {
      x: Math.round(viewportRect.x + win.scrollX),
      y: Math.round(viewportRect.y + win.scrollY),
      width: Math.round(viewportRect.width),
      height: Math.round(viewportRect.height),
    };
    anchors.forEach((cb) =>
      cb({
        selectors: [],
        label: `Region ${rect.width}×${rect.height}`,
        screenshot: { rect, png },
      }),
    );
  };

  return {
    setMode(mode: CaptureMode | null) {
      stopRegion?.();
      stopRegion = null;
      if (mode !== 'region') return inner.setMode(mode);
      inner.setMode(null);
      stopRegion = startViewportRegionSelect(doc, {
        onCancel: () => cancels.forEach((cb) => cb()),
        onRegion: (rect) => {
          capture(rect).catch((err: unknown) =>
            opts.onError?.(err instanceof Error ? err : new Error(String(err))),
          );
        },
      });
    },
    onAnchor(cb) {
      anchors.add(cb);
      return () => anchors.delete(cb);
    },
    onCancel(cb) {
      cancels.add(cb);
      return () => cancels.delete(cb);
    },
    onPinClick: (cb) => inner.onPinClick(cb),
    setPins: (pins: PinSpec[]) => inner.setPins(pins),
    focusPin: (id) => inner.focusPin(id),
    refresh: () => inner.refresh?.(),
    dispose() {
      stopRegion?.();
      subscriptions.forEach((u) => u());
      inner.dispose();
    },
  };
}

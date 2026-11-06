import type { Selector } from '@comment-everything/core/browser';
import { startElementPicker } from './element-picker.js';
import type { Anchor, CaptureMode, ContentAdapter, PinSpec, Unsubscribe } from './host-adapter.js';
import { PinLayer } from './pin-layer.js';
import { renderRegionPng, startRegionSelect } from './region-screenshot-capture.js';
import {
  labelForElement,
  labelForText,
  selectorsForElement,
  selectorsForRange,
} from './selector-builder.js';
import { resolveSelectors, type Anchorable } from './selector-resolver.js';
import { startTextSelectionCapture } from './text-selection-capture.js';

export interface InPageAdapterOptions {
  /** Document that holds the content (default: the global document). */
  doc?: Document;
  /** Root whose text defines TextPosition offsets (default: `doc.body`). */
  textRoot?: HTMLElement;
  /** Element rendered for region screenshots (default: `doc.body`). */
  captureRoot?: HTMLElement;
  /** Let a host add selectors (e.g. Markdown line ranges) or resolve its own kinds. */
  hooks?: {
    selectorsForElement?(el: Element): Selector[];
    selectorsForRange?(range: Range): Selector[];
    resolve?(selectors: readonly Selector[]): Anchorable | null;
  };
  /** Report a failed region capture. */
  onError?(error: Error): void;
}

type Listeners<T> = Set<(value: T) => void>;
const subscribe = <T>(set: Listeners<T>, cb: (value: T) => void): Unsubscribe => {
  set.add(cb);
  return () => set.delete(cb);
};

/**
 * `ContentAdapter` for content living in a normal document the overlay can touch directly:
 * the Markdown viewer, the Chrome extension, and the frame agent inside the sandboxed iframe.
 */
export function createInPageContentAdapter(opts: InPageAdapterOptions = {}): ContentAdapter {
  const doc = opts.doc ?? document;
  const textRoot = opts.textRoot ?? doc.body;
  const captureRoot = opts.captureRoot ?? doc.body;
  const anchors: Listeners<Anchor> = new Set();
  const pinClicks: Listeners<string> = new Set();
  const cancels: Listeners<void> = new Set();
  const emit = <T>(set: Listeners<T>, value: T) => set.forEach((cb) => cb(value));

  const resolve = (sels: readonly Selector[]) =>
    opts.hooks?.resolve?.(sels) ?? resolveSelectors(doc, textRoot, sels);
  const pins = new PinLayer(doc, resolve, (id) => emit(pinClicks, id));
  let stop: (() => void) | null = null;
  const cancel = () => emit(cancels, undefined);

  const startMode = (mode: CaptureMode): (() => void) => {
    switch (mode) {
      case 'element':
        return startElementPicker(doc, {
          onCancel: cancel,
          onPick: (el) =>
            emit(anchors, {
              selectors: opts.hooks?.selectorsForElement?.(el) ?? selectorsForElement(el, textRoot),
              label: labelForElement(el),
            }),
        });
      case 'text':
        return startTextSelectionCapture(doc, {
          onCancel: cancel,
          onSelect: (range) =>
            emit(anchors, {
              selectors:
                opts.hooks?.selectorsForRange?.(range) ?? selectorsForRange(range, textRoot),
              label: labelForText(range.toString()),
            }),
        });
      case 'region':
        return startRegionSelect(doc, {
          onCancel: cancel,
          onRegion: (rect) => {
            renderRegionPng(captureRoot, rect).then(
              (png) =>
                emit(anchors, {
                  selectors: [],
                  label: `Region ${rect.width}×${rect.height}`,
                  screenshot: { rect, png },
                }),
              (err: unknown) => opts.onError?.(err instanceof Error ? err : new Error(String(err))),
            );
          },
        });
    }
  };

  return {
    setMode(mode) {
      stop?.();
      stop = mode ? startMode(mode) : null;
    },
    onAnchor: (cb) => subscribe(anchors, cb),
    onPinClick: (cb) => subscribe(pinClicks, cb),
    onCancel: (cb) => subscribe(cancels as Listeners<void>, cb),
    setPins: (list: PinSpec[]) => pins.setPins(list),
    focusPin: (id) => pins.focus(id),
    refresh: () => pins.render(),
    dispose() {
      stop?.();
      pins.dispose();
    },
  };
}

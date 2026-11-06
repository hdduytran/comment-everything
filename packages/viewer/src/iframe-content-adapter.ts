import type { Anchor, CaptureMode, ContentAdapter, PinSpec } from '@comment-everything/overlay';
import {
  BRIDGE_TAG,
  parseFrameMessage,
  type ParentMessage,
  type Untagged,
} from './frame-bridge-protocol.js';

/**
 * `ContentAdapter` for the sandboxed HTML iframe. The frame agent inside the iframe does the
 * actual capturing; this adapter relays commands to it and surfaces its (validated) answers.
 * The latest mode and pins are replayed whenever the agent announces `ready` (after a reload).
 */
export function createIframeContentAdapter(iframe: HTMLIFrameElement): ContentAdapter {
  const anchors = new Set<(a: Anchor) => void>();
  const pinClicks = new Set<(id: string) => void>();
  const cancels = new Set<() => void>();
  let mode: CaptureMode | null = null;
  let pins: PinSpec[] = [];

  const post = (msg: Untagged<ParentMessage>) => {
    // Opaque-origin frames cannot be addressed by origin; the payload carries no secrets.
    iframe.contentWindow?.postMessage({ tag: BRIDGE_TAG, ...msg }, '*');
  };

  const onMessage = (ev: MessageEvent) => {
    if (ev.source === null || ev.source !== iframe.contentWindow) return;
    const msg = parseFrameMessage(ev.data);
    if (!msg) return;
    switch (msg.kind) {
      case 'ready':
        post({ kind: 'set-pins', pins });
        post({ kind: 'set-mode', mode });
        break;
      case 'anchor':
        anchors.forEach((cb) =>
          cb({ selectors: msg.selectors, label: msg.label, screenshot: msg.screenshot }),
        );
        break;
      case 'pin-click':
        pinClicks.forEach((cb) => cb(msg.id));
        break;
      case 'cancel':
        cancels.forEach((cb) => cb());
        break;
    }
  };
  window.addEventListener('message', onMessage);

  const sub = <T>(set: Set<T>, cb: T) => {
    set.add(cb);
    return () => set.delete(cb);
  };

  return {
    setMode(next) {
      mode = next;
      post({ kind: 'set-mode', mode });
    },
    onAnchor: (cb) => sub(anchors, cb),
    onPinClick: (cb) => sub(pinClicks, cb),
    onCancel: (cb) => sub(cancels, cb),
    setPins(next) {
      pins = next;
      post({ kind: 'set-pins', pins });
    },
    focusPin: (id) => post({ kind: 'focus-pin', id }),
    refresh: () => post({ kind: 'refresh' }),
    dispose: () => window.removeEventListener('message', onMessage),
  };
}

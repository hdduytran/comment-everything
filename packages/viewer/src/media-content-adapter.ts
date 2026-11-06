import {
  formatTimecode,
  mediaFragmentSelector,
  parseMediaFragment,
} from '@comment-everything/core/browser';
import type { Anchor, ContentAdapter, PinSpec } from '@comment-everything/overlay';
import type { RangeSpec } from './waveform-range-selector.js';

export interface MediaContentAdapter {
  adapter: ContentAdapter;
  /** The viewer finished a range (or a point when `end` is omitted): hand it to the overlay. */
  emitRange(start: number, end?: number): void;
  /** A range on the waveform was clicked: focus its comment card. */
  emitPinClick(id: string): void;
  onPins(cb: (ranges: RangeSpec[]) => void): void;
  onFocus(cb: (id: string) => void): void;
}

/** `00:12.400–00:15.000`, or one timecode for a point. */
export function rangeLabel(start: number, end?: number): string {
  return end === undefined || end <= start
    ? formatTimecode(start)
    : `${formatTimecode(start)}–${formatTimecode(end)}`;
}

/** Time ranges carried by the overlay's pins (pins without a time fragment are ignored). */
export function pinsToRanges(pins: PinSpec[]): RangeSpec[] {
  return pins.flatMap((p) => {
    for (const sel of p.selectors) {
      if (sel.type !== 'FragmentSelector') continue;
      const t = parseMediaFragment(sel);
      if (t) return [{ id: p.id, n: p.n, start: t.start, end: t.end }];
    }
    return [];
  });
}

/**
 * `ContentAdapter` for audio/video. Anchors are `t=start[,end]` media fragments created by the
 * viewer (drag, `[` / `]`, point); the overlay's capture modes do not apply, so none are offered.
 */
export function createMediaContentAdapter(): MediaContentAdapter {
  const anchors = new Set<(a: Anchor) => void>();
  const clicks = new Set<(id: string) => void>();
  const cancels = new Set<() => void>();
  const pinListeners: ((r: RangeSpec[]) => void)[] = [];
  const focusListeners: ((id: string) => void)[] = [];
  const sub = <T>(set: Set<T>, cb: T) => {
    set.add(cb);
    return () => set.delete(cb);
  };

  return {
    adapter: {
      modes: [],
      emptyHint:
        'Drag on the waveform, or press [ and ] at the playhead (p for a point), then write your comment.',
      setMode: () => undefined,
      onAnchor: (cb) => sub(anchors, cb),
      onPinClick: (cb) => sub(clicks, cb),
      onCancel: (cb) => sub(cancels, cb),
      setPins: (pins) => pinListeners.forEach((cb) => cb(pinsToRanges(pins))),
      focusPin: (id) => focusListeners.forEach((cb) => cb(id)),
      dispose() {
        anchors.clear();
        clicks.clear();
        cancels.clear();
      },
    },
    emitRange(start, end) {
      const isPoint = end === undefined || end <= start;
      const anchor: Anchor = {
        selectors: [mediaFragmentSelector(start, isPoint ? undefined : end)],
        label: rangeLabel(start, end),
      };
      anchors.forEach((cb) => cb(anchor));
    },
    emitPinClick: (id) => clicks.forEach((cb) => cb(id)),
    onPins: (cb) => void pinListeners.push(cb),
    onFocus: (cb) => void focusListeners.push(cb),
  };
}

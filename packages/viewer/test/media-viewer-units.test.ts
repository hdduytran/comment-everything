import { describe, expect, it, vi } from 'vitest';
import {
  createMediaContentAdapter,
  pinsToRanges,
  rangeLabel,
} from '../src/media-content-adapter.js';
import { isTypingTarget, mediaActionFor } from '../src/media-keyboard-shortcuts.js';
import { viewerKindFor } from '../src/viewer-router.js';

describe('mediaActionFor', () => {
  it('maps the documented keys', () => {
    expect(mediaActionFor({ key: '[' })).toEqual({ type: 'mark-in' });
    expect(mediaActionFor({ key: ']' })).toEqual({ type: 'mark-out' });
    expect(mediaActionFor({ key: ',' })).toEqual({ type: 'step-frame', direction: -1 });
    expect(mediaActionFor({ key: '.' })).toEqual({ type: 'step-frame', direction: 1 });
    expect(mediaActionFor({ key: 'ArrowRight', shiftKey: true })).toEqual({
      type: 'seek',
      seconds: 5,
    });
  });

  it('leaves modified and unknown keys alone', () => {
    expect(mediaActionFor({ key: '[', metaKey: true })).toBeNull();
    expect(mediaActionFor({ key: 'x' })).toBeNull();
  });

  it('ignores typing targets', () => {
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
  });
});

describe('media content adapter', () => {
  it('emits a fragment anchor for a range and for a point', () => {
    const { adapter, emitRange } = createMediaContentAdapter();
    const seen = vi.fn();
    adapter.onAnchor(seen);
    emitRange(12.4, 15);
    emitRange(3);
    expect(seen.mock.calls[0]![0]).toEqual({
      selectors: [
        {
          type: 'FragmentSelector',
          conformsTo: 'http://www.w3.org/TR/media-frags/',
          value: 't=12.4,15',
        },
      ],
      label: '00:12.400–00:15.000',
    });
    expect(seen.mock.calls[1]![0].selectors[0].value).toBe('t=3');
    expect(seen.mock.calls[1]![0].label).toBe('00:03.000');
  });

  it('offers no capture modes and converts pins to ranges', () => {
    const bridge = createMediaContentAdapter();
    expect(bridge.adapter.modes).toEqual([]);
    const ranges = vi.fn();
    bridge.onPins(ranges);
    bridge.adapter.setPins([
      {
        id: 'a',
        n: 1,
        selectors: [
          {
            type: 'FragmentSelector',
            conformsTo: 'http://www.w3.org/TR/media-frags/',
            value: 't=1,2',
          },
        ],
      },
      { id: 'b', n: 2, selectors: [{ type: 'CssSelector', value: 'p' }] },
    ]);
    expect(ranges).toHaveBeenCalledWith([{ id: 'a', n: 1, start: 1, end: 2 }]);
    expect(pinsToRanges([])).toEqual([]);
    expect(rangeLabel(61.5, 61.5)).toBe('01:01.500');
  });
});

describe('viewer routing', () => {
  it('routes media extensions to the media viewer', () => {
    for (const f of ['a.mp4', 'a.webm', 'a.MOV', 'a.mkv']) expect(viewerKindFor(f)).toBe('video');
    for (const f of ['a.mp3', 'a.wav', 'a.m4a', 'a.ogg', 'a.flac']) {
      expect(viewerKindFor(f)).toBe('audio');
    }
    expect(viewerKindFor('a.md')).toBe('markdown');
  });
});

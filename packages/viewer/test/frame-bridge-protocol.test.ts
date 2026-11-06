import { describe, expect, it } from 'vitest';
import {
  BRIDGE_TAG,
  MAX_SCREENSHOT_BYTES,
  parseFrameMessage,
  parseParentMessage,
} from '../src/frame-bridge-protocol.js';
import { viewerKindFor } from '../src/viewer-router.js';

describe('frame bridge protocol', () => {
  it('accepts well-formed frame messages', () => {
    const anchor = parseFrameMessage({
      tag: BRIDGE_TAG,
      kind: 'anchor',
      label: '<p> hi',
      selectors: [{ type: 'CssSelector', value: 'p' }],
    });
    expect(anchor).toMatchObject({ kind: 'anchor' });
    expect(parseFrameMessage({ tag: BRIDGE_TAG, kind: 'ready' })).toMatchObject({ kind: 'ready' });
  });

  it('rejects wrong tags, unknown kinds, bad selectors and oversized screenshots', () => {
    expect(parseFrameMessage({ kind: 'ready' })).toBeNull();
    expect(parseFrameMessage({ tag: 'other', kind: 'ready' })).toBeNull();
    expect(parseFrameMessage({ tag: BRIDGE_TAG, kind: 'steal-token' })).toBeNull();
    expect(
      parseFrameMessage({
        tag: BRIDGE_TAG,
        kind: 'anchor',
        label: 'x',
        selectors: [{ type: 'CssSelector', value: '' }],
      }),
    ).toBeNull();
    expect(parseFrameMessage('hello')).toBeNull();
    expect(parseFrameMessage(null)).toBeNull();
    const big = { size: MAX_SCREENSHOT_BYTES + 1 };
    Object.setPrototypeOf(big, Blob.prototype);
    expect(
      parseFrameMessage({
        tag: BRIDGE_TAG,
        kind: 'anchor',
        label: 'x',
        selectors: [],
        screenshot: { rect: { x: 0, y: 0, width: 1, height: 1 }, png: big },
      }),
    ).toBeNull();
  });

  it('validates parent messages sent to the frame agent', () => {
    expect(parseParentMessage({ tag: BRIDGE_TAG, kind: 'set-mode', mode: 'text' })).not.toBeNull();
    expect(parseParentMessage({ tag: BRIDGE_TAG, kind: 'set-mode', mode: 'rm -rf' })).toBeNull();
    expect(parseParentMessage({ tag: BRIDGE_TAG, kind: 'set-pins', pins: [{ id: 1 }] })).toBeNull();
  });
});

describe('viewer router', () => {
  it('picks the viewer by file extension', () => {
    expect(viewerKindFor('a/b/index.HTML')).toBe('html');
    expect(viewerKindFor('page.htm')).toBe('html');
    expect(viewerKindFor('README.md')).toBe('markdown');
    expect(viewerKindFor('notes.markdown')).toBe('markdown');
    expect(viewerKindFor('clip.mp4')).toBe('unsupported');
    expect(viewerKindFor('Makefile')).toBe('unsupported');
  });
});

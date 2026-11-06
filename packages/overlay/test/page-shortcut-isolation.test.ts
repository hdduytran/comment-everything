import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startElementPicker } from '../src/element-picker.js';
import { ISOLATED_EVENTS } from '../src/event-isolation.js';
import { createOverlay } from '../src/overlay-root-shadow-dom.js';
import { anchor, fakeContent, fakeDaemon, realEvent, tick } from './overlay-fakes.js';

let mountEl: HTMLElement;
let handle: ReturnType<typeof createOverlay> | undefined;
let content: ReturnType<typeof fakeContent>;
let daemon: ReturnType<typeof fakeDaemon>['daemon'];
beforeEach(() => {
  content = fakeContent();
  daemon = fakeDaemon().daemon;
  mountEl = document.createElement('div');
  document.body.append(mountEl);
  handle = createOverlay({ source: 'a.html', content: content.adapter, daemon, mount: mountEl });
  content.emit(anchor('#a', 'Alpha'));
});
afterEach(() => {
  handle?.dispose();
  mountEl.remove();
});

const shadow = () => mountEl.querySelector('[data-ce-host]')!.shadowRoot!;
const area = () => shadow().querySelector('textarea')!;

/** Page-style listeners at every level a site might bind its shortcuts. */
function pageListeners(type: string) {
  const spy = vi.fn();
  const targets: EventTarget[] = [window, document, document.body, mountEl];
  for (const t of targets) {
    t.addEventListener(type, spy);
    t.addEventListener(type, spy, true);
  }
  return {
    spy,
    off: () =>
      targets.forEach(
        (t) => (t.removeEventListener(type, spy), t.removeEventListener(type, spy, true)),
      ),
  };
}

describe('page shortcut isolation', () => {
  it.each(ISOLATED_EVENTS)('%s typed in the panel never reaches page listeners', async (type) => {
    await tick();
    const page = pageListeners(type);
    const ev = realEvent(type.startsWith('key') ? KeyboardEvent : Event, type, { key: 's' });
    area().dispatchEvent(ev);
    expect(page.spy).not.toHaveBeenCalled();
    // Typing must keep working: nothing may cancel the default action.
    expect(ev.defaultPrevented).toBe(false);
    page.off();
  });

  it('still delivers the same keystrokes to the page when focus is on the page', () => {
    const page = pageListeners('keydown');
    document.body.dispatchEvent(realEvent(KeyboardEvent, 'keydown', { key: 's' }));
    expect(page.spy).toHaveBeenCalled();
    page.off();
  });

  it('keeps the draft text in sync while typing', () => {
    area().value = 'press s then / then g';
    area().dispatchEvent(realEvent(Event, 'input'));
    shadow().querySelector<HTMLButtonElement>('[data-ce=send]')!.click();
    return tick().then(() => {
      expect(daemon.sendBatch).toHaveBeenCalledWith([
        expect.objectContaining({ text: 'press s then / then g' }),
      ]);
    });
  });

  it('IME composition events stay inside the panel and are not cancelled', () => {
    const page = pageListeners('compositionend');
    const ev = realEvent(CompositionEvent, 'compositionend', { data: 'việt' });
    area().dispatchEvent(ev);
    expect(page.spy).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    page.off();
  });

  it('Ctrl+Enter and Cmd+Enter send; Enter during IME composition does not', async () => {
    area().value = 'ok';
    area().dispatchEvent(realEvent(Event, 'input'));
    area().dispatchEvent(
      realEvent(KeyboardEvent, 'keydown', { key: 'Enter', ctrlKey: true, isComposing: true }),
    );
    await tick();
    expect(daemon.sendBatch).not.toHaveBeenCalled();
    area().dispatchEvent(realEvent(KeyboardEvent, 'keydown', { key: 'Enter', metaKey: true }));
    await tick();
    expect(daemon.sendBatch).toHaveBeenCalledOnce();
  });

  it('Esc stops the active capture mode and is not leaked to the page', () => {
    shadow().querySelector<HTMLButtonElement>('[data-ce=mode-element]')!.click();
    expect(content.modes.at(-1)).toBe('element');
    const page = pageListeners('keydown');
    area().dispatchEvent(realEvent(KeyboardEvent, 'keydown', { key: 'Escape' }));
    expect(content.modes.at(-1)).toBeNull();
    expect(page.spy).not.toHaveBeenCalled();
    page.off();
  });
});

describe('element picker', () => {
  it('does not leak pointer, mouse or click events to page listeners', () => {
    const target = document.createElement('a');
    target.href = '#x';
    document.body.append(target);
    const picked = vi.fn();
    const stop = startElementPicker(document, { onPick: picked, onCancel: vi.fn() });
    const types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick'];
    const spies = types.map((t) => {
      const spy = vi.fn();
      document.addEventListener(t, spy);
      document.body.addEventListener(t, spy);
      target.addEventListener(t, spy);
      return spy;
    });
    for (const t of types) target.dispatchEvent(realEvent(MouseEvent, t));
    expect(spies.every((s) => s.mock.calls.length === 0)).toBe(true);
    expect(picked).toHaveBeenCalledWith(target);
    stop();
    target.remove();
  });
});

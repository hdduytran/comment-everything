import { afterEach, describe, expect, it, vi } from 'vitest';
import { installEventShield } from '../src/event-isolation.js';
import { createOverlay } from '../src/overlay-root-shadow-dom.js';
import { anchor, fakeContent, fakeDaemon, realEvent, tick } from './overlay-fakes.js';

/**
 * jsdom has one window per file, so the shield (which cannot be uninstalled) is installed once and
 * every test mounts its own overlay after registering a "page" listener, like a real site that
 * runs its scripts after document_start but before the overlay exists.
 */
installEventShield(window);

let mountEl: HTMLElement | undefined;
let handle: ReturnType<typeof createOverlay> | undefined;
afterEach(() => {
  handle?.dispose();
  mountEl?.remove();
});

function mountOverlay() {
  mountEl = document.createElement('div');
  document.body.append(mountEl);
  const content = fakeContent();
  handle = createOverlay({
    source: 'a.html',
    content: content.adapter,
    daemon: fakeDaemon().daemon,
    mount: mountEl,
  });
  content.emit(anchor('#a', 'Alpha'));
  return mountEl.querySelector('[data-ce-host]')!.shadowRoot!;
}

describe('early event shield', () => {
  it('hides keystrokes typed in the panel from page listeners registered before the overlay', async () => {
    const pageSpy = vi.fn();
    window.addEventListener('keydown', pageSpy, true); // a site's early capture listener
    document.addEventListener('keydown', pageSpy, true);
    const shadow = mountOverlay();
    await tick();
    const area = shadow.querySelector('textarea')!;
    const ev = realEvent(KeyboardEvent, 'keydown', { key: 's' });
    area.dispatchEvent(ev);
    expect(pageSpy).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    window.removeEventListener('keydown', pageSpy, true);
    document.removeEventListener('keydown', pageSpy, true);
  });

  it("still runs the overlay's own handlers (text sync, Ctrl+Enter, Esc)", async () => {
    const shadow = mountOverlay();
    await tick();
    const area = shadow.querySelector('textarea')!;
    area.value = 'typed under the shield';
    area.dispatchEvent(realEvent(Event, 'input'));
    area.dispatchEvent(realEvent(KeyboardEvent, 'keydown', { key: 'Enter', ctrlKey: true }));
    await tick();
    expect(shadow.querySelector('[data-ce=toast] .toast-text')!.textContent).toMatch(
      /^(Sent|Saved)/,
    );
  });

  it('does not touch events that come from the page itself', () => {
    const pageSpy = vi.fn();
    window.addEventListener('keydown', pageSpy, true);
    document.body.dispatchEvent(realEvent(KeyboardEvent, 'keydown', { key: 's' }));
    expect(pageSpy).toHaveBeenCalledOnce();
    window.removeEventListener('keydown', pageSpy, true);
  });

  it('installing twice does not add a second set of listeners', () => {
    const add = vi.spyOn(window, 'addEventListener');
    installEventShield(window);
    expect(add).not.toHaveBeenCalled();
    add.mockRestore();
  });
});

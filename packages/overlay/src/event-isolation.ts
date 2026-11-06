/**
 * Keeps typing inside the overlay away from the host page. Sites such as GitHub and Facebook bind
 * single-key shortcuts on `document`/`window`; without isolation, typing `s` or `/` in our comment
 * box would trigger them. Events that originate inside the overlay's shadow root are stopped at
 * the top of the capture phase (`window`), before any page listener registered later can see them.
 *
 * `stopImmediatePropagation` also hides the event from the overlay's own listeners, so the
 * overlay registers its handlers through `listen()`: they run first, then the event is hidden.
 * `preventDefault` is never called, so text entry, caret movement and IME composition still work.
 */

import { HOST_ATTR } from './dom-helpers.js';

/** Event types that carry typing, clipboard, IME or focus state. */
export const ISOLATED_EVENTS = [
  'keydown',
  'keypress',
  'keyup',
  'beforeinput',
  'input',
  'paste',
  'copy',
  'cut',
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'focusin',
  'focusout',
] as const;

export type IsolatedEventType = (typeof ISOLATED_EVENTS)[number];

type OwnHandlers = Map<string, Set<(ev: Event) => void>>;

/** Per-window registry shared by the early shield and the overlays mounted later. */
interface EventShield {
  hosts: Map<Element, OwnHandlers>;
}
const SHIELD_KEY = Symbol.for('comment-everything.event-shield');
type ShieldWindow = Window & { [SHIELD_KEY]?: EventShield };

function runOwn(own: OwnHandlers | undefined, type: string, ev: Event): void {
  own?.get(type)?.forEach((fn) => {
    try {
      fn(ev);
    } catch (err) {
      console.error('[comment-everything] overlay handler failed:', err);
    }
  });
}

/**
 * Install the capture-phase listeners as early as possible (a `document_start` content script),
 * so listeners the page registers before the overlay is mounted cannot see keystrokes typed in
 * it. The shield owns the window listeners; an `EventIsolation` created later registers its
 * handlers here instead of adding listeners of its own, so they still run first. The registry
 * lives in the content script's isolated world, out of the page's reach. Safe to call twice.
 */
export function installEventShield(win: Window): void {
  const w = win as ShieldWindow;
  if (w[SHIELD_KEY]) return;
  const shield: EventShield = { hosts: new Map() };
  w[SHIELD_KEY] = shield;
  for (const type of ISOLATED_EVENTS) {
    win.addEventListener(
      type,
      (ev) => {
        const host = ev
          .composedPath()
          .find((n) => n instanceof Element && n.hasAttribute(HOST_ATTR));
        if (!host) return;
        runOwn(shield.hosts.get(host as Element), type, ev);
        ev.stopImmediatePropagation();
      },
      true,
    );
  }
}

export class EventIsolation {
  private readonly own: OwnHandlers = new Map();
  private readonly cleanups: (() => void)[] = [];

  /** `host` is the shadow host element; `win` the window of the document it lives in. */
  constructor(host: HTMLElement, win: Window) {
    const shield = (win as ShieldWindow)[SHIELD_KEY];
    if (shield) {
      shield.hosts.set(host, this.own);
      this.cleanups.push(() => shield.hosts.delete(host));
    }
    for (const type of ISOLATED_EVENTS) {
      if (!shield) {
        const atWindow = (ev: Event) => {
          if (!ev.composedPath().includes(host)) return;
          runOwn(this.own, type, ev);
          ev.stopImmediatePropagation();
        };
        win.addEventListener(type, atWindow, true);
        this.cleanups.push(() => win.removeEventListener(type, atWindow, true));
      }
      // Second line of defence: nothing bubbles out of the host to page ancestors.
      const atHost = (ev: Event) => ev.stopPropagation();
      host.addEventListener(type, atHost);
      this.cleanups.push(() => host.removeEventListener(type, atHost));
    }
  }

  /** Run `fn` for events from inside the overlay, before they are hidden from the page. */
  listen(type: IsolatedEventType, fn: (ev: Event) => void): () => void {
    const set = this.own.get(type) ?? new Set();
    set.add(fn);
    this.own.set(type, set);
    return () => set.delete(fn);
  }

  dispose(): void {
    this.cleanups.splice(0).forEach((fn) => fn());
    this.own.clear();
  }
}

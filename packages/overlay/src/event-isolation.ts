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

export class EventIsolation {
  private readonly own = new Map<string, Set<(ev: Event) => void>>();
  private readonly cleanups: (() => void)[] = [];

  /** `host` is the shadow host element; `win` the window of the document it lives in. */
  constructor(host: HTMLElement, win: Window) {
    for (const type of ISOLATED_EVENTS) {
      const atWindow = (ev: Event) => {
        if (!ev.composedPath().includes(host)) return;
        this.own.get(type)?.forEach((fn) => {
          try {
            fn(ev);
          } catch (err) {
            console.error('[comment-everything] overlay handler failed:', err);
          }
        });
        ev.stopImmediatePropagation();
      };
      win.addEventListener(type, atWindow, true);
      // Second line of defence: nothing bubbles out of the host to page ancestors.
      const atHost = (ev: Event) => ev.stopPropagation();
      host.addEventListener(type, atHost);
      this.cleanups.push(() => {
        win.removeEventListener(type, atWindow, true);
        host.removeEventListener(type, atHost);
      });
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

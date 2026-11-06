export type MediaAction =
  | { type: 'toggle-play' }
  | { type: 'mark-in' }
  | { type: 'mark-out' }
  | { type: 'point' }
  | { type: 'toggle-loop' }
  | { type: 'step-frame'; direction: 1 | -1 }
  | { type: 'seek'; seconds: number };

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** Map a key press to a media action; modified keys are left to the browser. */
export function mediaActionFor(e: KeyLike): MediaAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case ' ':
    case 'k':
      return { type: 'toggle-play' };
    case '[':
      return { type: 'mark-in' };
    case ']':
      return { type: 'mark-out' };
    case 'p':
      return { type: 'point' };
    case 'l':
      return { type: 'toggle-loop' };
    case ',':
    case '<':
      return { type: 'step-frame', direction: -1 };
    case '.':
    case '>':
      return { type: 'step-frame', direction: 1 };
    case 'ArrowLeft':
      return { type: 'seek', seconds: e.shiftKey ? -5 : -1 };
    case 'ArrowRight':
      return { type: 'seek', seconds: e.shiftKey ? 5 : 1 };
    default:
      return null;
  }
}

/** True when the key press happened in a field where typing must not trigger shortcuts. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node || typeof node.tagName !== 'string') return false;
  const tag = node.tagName.toLowerCase();
  return (
    tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable === true
  );
}

/**
 * Listen for shortcuts on the document. Key events from inside the overlay's shadow root are
 * retargeted to its host, so the real origin is read from `composedPath()`.
 */
export function bindMediaShortcuts(doc: Document, run: (a: MediaAction) => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    const origin = e.composedPath()[0] ?? e.target;
    if (isTypingTarget(origin)) return;
    const action = mediaActionFor(e);
    if (!action) return;
    e.preventDefault();
    run(action);
  };
  doc.addEventListener('keydown', onKey);
  return () => doc.removeEventListener('keydown', onKey);
}

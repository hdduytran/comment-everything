import { isOverlayNode } from './dom-helpers.js';

export interface TextCaptureCallbacks {
  onSelect(range: Range): void;
  onCancel(): void;
}

/**
 * Text-select mode: when the user finishes a selection (mouse up / shift+arrows), the selected
 * range is reported and the browser selection is cleared so the next one starts clean.
 * Returns a function that stops the mode.
 */
export function startTextSelectionCapture(doc: Document, cb: TextCaptureCallbacks): () => void {
  const win = doc.defaultView as Window;

  const check = () => {
    const sel = win.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0).cloneRange();
    const anchorEl =
      range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    if (!range.toString().trim() || isOverlayNode(anchorEl)) return;
    sel.removeAllRanges();
    cb.onSelect(range);
  };
  // Defer: the browser finalizes the selection after the mouseup event has been dispatched.
  const onMouseUp = (ev: MouseEvent) => {
    if (!isOverlayNode(ev.target)) win.setTimeout(check, 0);
  };
  const onKeyUp = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') cb.onCancel();
    else if (ev.shiftKey) check();
  };

  doc.addEventListener('mouseup', onMouseUp, true);
  doc.addEventListener('keyup', onKeyUp, true);
  return () => {
    doc.removeEventListener('mouseup', onMouseUp, true);
    doc.removeEventListener('keyup', onKeyUp, true);
  };
}

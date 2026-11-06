import { TOOLTIP_CSS, TooltipController, tokensCss } from '@comment-everything/overlay';

let shared: TooltipController | null = null;

/**
 * Tooltips for the viewer's own chrome (media controls). Installs the overlay's design tokens on
 * `:root` once, so the viewer and the panel share one palette, and keeps a single tooltip layer
 * in `document.body`. Esc dismisses the visible tooltip.
 */
export function viewerTooltips(doc: Document = document): TooltipController {
  if (shared) return shared;
  const css = tokensCss(':root') + TOOLTIP_CSS;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  } catch {
    const style = doc.createElement('style');
    style.textContent = css;
    doc.head.append(style);
  }
  const layer = doc.createElement('div');
  layer.className = 'ce-tips';
  doc.body.append(layer);
  const tips = new TooltipController(doc, layer);
  doc.addEventListener('keydown', (e) => e.key === 'Escape' && tips.hide());
  shared = tips;
  return tips;
}

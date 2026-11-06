export * from './host-adapter.js';
export { createOverlay } from './overlay-root-shadow-dom.js';
export { createHttpDaemonTransport, type HttpTransportOptions } from './daemon-client.js';
export {
  createInPageContentAdapter,
  type InPageAdapterOptions,
} from './in-page-content-adapter.js';
export { defaultCopyText } from './clipboard-copy.js';
export { PANEL_WIDTH_PX } from './overlay-styles.js';
export { DraftStore, buildPrompt, draftsToComments, type Draft } from './overlay-state.js';
export {
  cssSelectorFor,
  xpathFor,
  selectorsForElement,
  selectorsForRange,
  quoteSelectorsForRange,
  labelForElement,
  labelForText,
} from './selector-builder.js';
export { resolveSelectors, rectsOf, type Anchorable } from './selector-resolver.js';
export { findQuote, fullText, offsetOf, rangeFromOffsets } from './text-index.js';
export { renderRegionPng } from './region-screenshot-capture.js';
export { HOST_ATTR, isOverlayNode } from './dom-helpers.js';
export {
  TooltipController,
  TOOLTIP_DELAY_MS,
  modKeyLabel,
  type TooltipHandle,
  type TooltipSpec,
} from './tooltip-controller.js';
export { TOOLTIP_CSS } from './tooltip-styles.js';
export { tokensCss } from './overlay-tokens.js';
export { icon, type IconName } from './icons.js';
export { installEventShield } from './event-isolation.js';

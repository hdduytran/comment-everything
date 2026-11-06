# Phase 3 — Overlay + HTML/MD viewer + Copy prompt

## Requirements
- `overlay` package (framework-light: Preact or vanilla + Shadow DOM to avoid CSS clashes):
  - Modes: element pick (hover highlight), text selection, region screenshot (drag rect).
  - Multi-select: numbered pins on page; side panel lists pending comments.
  - Buttons: **Send** (POST batch), **Copy prompt**, clear. Shows status updates live via SSE (open → resolved, with agent note).
  - Builds selectors: TextQuote + CSS + XPath for elements; screenshot via html2canvas-like capture (viewer) or `chrome.tabs.captureVisibleTab` (extension).
- `viewer` app (Vite), served by daemon at `/view?path=`:
  - HTML: render file in same-origin iframe from `/files/`, inject overlay into iframe.
  - MD: render with markdown-it; add `data-line` source mapping per block so comments carry `LineRangeSelector` (`file.md:42-48`). Support GFM, code highlight, mermaid.
  - Auto reload when file changes (watcher) so user sees AI edits.
- `open` command: detect type by extension, register project root, open browser at viewer URL.

## Files
`packages/overlay/src/{overlay-root-shadow-dom,element-picker,text-selection-capture,region-screenshot-capture,comment-side-panel,selector-builder,daemon-client}.ts`, `packages/viewer/src/{viewer-router,html-iframe-viewer,markdown-line-mapped-viewer}.ts`.

## Validation
- Playwright e2e: open fixture HTML, comment on 3 elements, Send → 3 JSON files with correct selectors; MD comment maps to correct lines.
- Copy prompt snapshot test.

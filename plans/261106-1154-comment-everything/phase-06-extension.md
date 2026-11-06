# Phase 6 — Chrome extension (MV3)

## Requirements
- Toolbar button / shortcut toggles overlay on current tab (reuse `overlay` package, bundled).
- Pairing: extension opens `http://127.0.0.1:4317/pair` once, receives token, stores in `chrome.storage.local`.
- Screenshots via `chrome.tabs.captureVisibleTab` + crop.
- Source = page URL; map localhost dev URLs to a project root (user picks once; remembered per origin) so comments land in that project's `.comments/`.
- Minimal permissions: `activeTab`, `scripting`, `storage`; host permission only for `127.0.0.1` daemon.
- Show daemon-not-running state with the `npx comment-everything serve` hint.

## Files
`packages/extension/{manifest.json,src/background-service-worker.ts,src/content-overlay-injector.ts,src/daemon-pairing.ts,src/origin-to-project-mapping.ts}`.

## Validation
- Playwright with extension loaded: comment on a localhost page → JSON in mapped project.
- Chrome Web Store listing prepared (privacy: no remote servers).

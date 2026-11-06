# @comment-everything/extension

Chrome (Manifest V3) extension that comments on live web pages and sends them to the local daemon.

## Build and load

```sh
pnpm --filter @comment-everything/extension build
```

Open `chrome://extensions`, enable Developer mode, choose "Load unpacked", and select `packages/extension/dist`.

## Use

1. `npx comment-everything serve`
2. Click the toolbar button or press Alt+Shift+C on a page.
3. First time: press "Pair" and confirm on the page the daemon opens. Then pick the project that serves the site (remembered per origin).
4. Comment, then Send. Files appear in `<project>/.comments/` with the page URL as `source`.

## How it fits together

- `background-service-worker.ts`: toolbar/shortcut, status, daemon requests (the token never leaves the worker), SSE relay, screenshot capture.
- `content-overlay-injector.ts`: bundled overlay injected into the tab; talks to the worker via `content-proxy-transport.ts`.
- `daemon-pairing.ts`: pairing handshake (`/pair` page on the daemon delivers the token through `externally_connectable`).
- `origin-to-project-mapping.ts`: origin to project root, stored in `chrome.storage.local`.
- `store/`: Chrome Web Store listing text and privacy statement.

The daemon port defaults to 4317. To use another port set `daemonPort` in the extension's `chrome.storage.local` (and extend `host_permissions`).

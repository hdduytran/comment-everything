# @comment-everything/extension

Chrome (Manifest V3) extension that comments on live web pages. It works on its own (comments stay in the browser, with export and copy for Claude) and sends them to the local daemon when one is paired.

## Build and load

```sh
pnpm --filter @comment-everything/extension build
```

Open `chrome://extensions`, enable Developer mode, choose "Load unpacked", and select `packages/extension/dist`.

## Use

Click the toolbar button or press Alt+Shift+C on a page.

**Extension only** (nothing else installed). When the daemon is not running, or this browser is not paired, the panel header shows "Extension only". Comments stay in this browser. Pending comments can be handed over three ways:

1. Copy prompt: Markdown; with screenshots it is a rich clipboard item (text/html with inline images plus text/plain).
2. Export: `Downloads/comment-everything/<host>/<yyyy-mm-dd-hhmm>/comments.md`, `comments.json`, `assets/*.png`, then a copyable sentence for Claude Code. Two exports in the same minute get `-2`, `-3`.
3. Open in Claude: copies the prompt, then opens a blank `https://claude.ai/new`. Comment content is never put in the address.

**Daemon** (automatic Send):

1. `npx comment-everything serve`
2. Open the panel. First time: press "Pair" (or the Pair offer) and confirm on the page the daemon opens. Then pick the project that serves the site (remembered per origin).
3. Comment, then Send. Files appear in `<project>/.comments/` with the page URL as `source`. Comments saved in extension-only mode are offered as "Move N to project" and removed locally once the daemon accepts them (resolved ones stay).

**Options page** (`chrome://extensions` > Details > Extension options): choose Auto (default), Standalone only or Daemon, and switch on the early keyboard shield.

## Permissions

| Permission                                  | Why                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `activeTab`, `scripting`                    | Inject the overlay into the tab you invoke it on; capture the visible tab for screenshot regions.                              |
| `storage`                                   | Pairing token, origin-to-project mapping, mode preference and (extension only) your saved comments. Local, never synced.       |
| `downloads`                                 | Export saves `comments.md`, `comments.json` and screenshots into `Downloads/comment-everything/`. Only on Export.              |
| Host `http://127.0.0.1:4317/*`              | Talk to the local daemon (health probe and paired requests). No other host is contacted by the extension.                      |
| Optional host `<all_urls>` (off by default) | Only if you switch on the early keyboard shield, so a tiny script can load before a page's own scripts on sites you have used. |

`clipboardWrite` is not requested: copying happens in direct response to your click, which the browser allows without it.

### Early keyboard shield trade-off

Keys typed in the comment box are already hidden from the page once the panel is open. A site listener registered on `window` in the capture phase before that (at load time) still sees them. Closing the gap needs a `document_start` script, which needs host access before any click. A static `<all_urls>` script would add an install-time "all websites" warning for everyone, and per-origin permission prompts would break "click and comment". So it is opt-in: with the toggle off nothing changes; with it on, Chrome asks once for all-sites access and the script is registered only for origins where the panel was opened before. It reads nothing from the page.

## How it fits together

- `background-service-worker.ts`: toolbar/shortcut, status, daemon requests (the token never leaves the worker), SSE relay, screenshot capture.
- `content-overlay-injector.ts`: bundled overlay injected into the tab; talks to the worker via `content-proxy-transport.ts`.
- `extension-mode.ts` / `extension-status.ts`: Auto / Standalone / Daemon decision on each toggle (800 ms `/health` probe in Auto).
- `local-comment-store.ts`: the standalone `DaemonTransport` over `chrome.storage.local` (zod-validated), plus helpers to list and remove local comments.
- `local-asset-store.ts`: screenshot blobs in IndexedDB (service worker side) and the content-side proxy.
- `standalone-export-files.ts` / `standalone-worker-handlers.ts`: export layout and `chrome.downloads`; asset, export and open-claude messages.
- `rich-prompt-clipboard.ts` / `standalone-delivery.ts`: rich Copy prompt, Export and Open in Claude for the overlay.
- `migrate-local-comments.ts`: move local comments to the mapped project after pairing.
- `early-shield-registration.ts` / `early-event-shield.ts`: opt-in `document_start` shield.
- `options-page.ts`: the options page.
- `daemon-pairing.ts`: pairing handshake (`/pair` page on the daemon delivers the token through `externally_connectable`).
- `origin-to-project-mapping.ts`: origin to project root, stored in `chrome.storage.local`.
- `store/`: Chrome Web Store listing text and privacy statement.

The daemon port defaults to 4317. To use another port set `daemonPort` in the extension's `chrome.storage.local` (and extend `host_permissions`).

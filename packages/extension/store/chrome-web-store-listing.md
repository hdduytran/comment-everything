# Chrome Web Store listing

## Name

Comment Everything

## Summary (max 132 characters)

Comment on any web page and hand the comments to Claude. Works on its own; local only, no accounts.

## Category

Developer Tools

## Description

Comment Everything lets you point at things on a live web page (an element, a text selection, or a screenshot region), write what should change, and hand the comments to Claude. It works on its own, with nothing else installed.

Extension only (default when no daemon is running)

1. Click the toolbar button (or press Alt+Shift+C) on the page you are working on.
2. Select several things and write a comment for each. Comments are kept in your browser.
3. Copy prompt (includes screenshots where the chat app accepts pasted images), Export files to your Downloads folder for Claude Code to read, or Open in Claude (copies the prompt and opens a blank claude.ai chat).

Nothing leaves your browser in this mode.

With the optional local daemon (`npx comment-everything serve`)

- Pair once, pick the project folder that serves the site, and press Send: comments land as plain JSON in the project's `.comments/` folder and your coding agent (Claude Code, Claude Desktop, or any MCP client) picks them up, makes the change, and marks them resolved.
- Comments saved earlier in extension-only mode can be moved into the project.

Highlights

- Element, text and screenshot-region comments with numbered pins.
- Works with no install beyond the extension; add the free, open-source `comment-everything` command-line tool for automatic Send.
- Nothing leaves your computer. There is no account, no analytics, and no remote server.

## Single purpose

Let the user annotate the web page they are viewing and keep those annotations in their browser, export them to their Downloads folder, or save them to a local daemon on their own machine.

## Permission justifications

- `activeTab`: lets the toolbar button or keyboard shortcut act on the current tab only, after the user invokes it. Also allows capturing the visible tab for screenshot comments.
- `scripting`: injects the commenting overlay into the active tab when the user invokes the extension.
- `storage`: remembers the mode preference, the pairing token for the local daemon, which project folder each site maps to, and (in extension-only mode) the comments you write. Stored locally and never synced.
- `downloads`: used only when you press Export, to save `comments.md`, `comments.json` and screenshots into `Downloads/comment-everything/`.
- Host permission `http://127.0.0.1:4317/*`: talks to the local daemon on the user's own machine. No other host is contacted.
- Optional host permission `<all_urls>`: requested only if the user turns on the early keyboard shield in the options page. It lets a tiny script load before a page's own scripts, on sites where the user already opened the panel, so typing a comment cannot trigger that site's keyboard shortcuts. The script reads nothing from the page. Off by default.
- Clipboard: copying the prompt happens on the user's click; no clipboard permission is requested.
- `externally_connectable` for `http://127.0.0.1/*`: lets the daemon's pairing page, which the user opens and confirms, hand the extension its token. No website can reach the extension.

## Remote code

None. All code is bundled in the package.

## Assets to prepare

- Icon 128x128: `icons/icon-128.png`.
- At least one 1280x800 screenshot of the overlay on a page and one of the project-mapping card.
- Privacy policy: publish `privacy-policy.md` at a public URL and enter it in the dashboard.

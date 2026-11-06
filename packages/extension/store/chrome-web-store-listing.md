# Chrome Web Store listing

## Name

Comment Everything

## Summary (max 132 characters)

Comment on any web page and hand the comments to Claude Code or any MCP agent. Local only, no accounts.

## Category

Developer Tools

## Description

Comment Everything lets you point at things on a live web page (an element, a text selection, or a screenshot region), write what should change, and press Send. Your comments are saved as plain JSON files in your project's `.comments/` folder, and your coding agent (Claude Code, Claude Desktop, or any MCP client) picks them up, makes the change, and marks them resolved.

How it works

1. Start the local daemon: `npx comment-everything serve`.
2. Click the toolbar button (or press Alt+Shift+C) on the page you are working on.
3. First time only: pair the extension with your daemon, then pick which project folder serves this site (for example localhost:3000 maps to /path/to/project).
4. Select several things, write a comment for each, and press Send.

Highlights

- Element, text and screenshot-region comments with numbered pins.
- Comments land in the mapped project, next to your code.
- "Copy prompt" produces a self-contained Markdown prompt for any chat.
- Nothing leaves your computer. There is no account, no analytics, and no remote server.

Requires the free, open-source `comment-everything` command-line tool running on your machine.

## Single purpose

Let the user annotate the web page they are viewing and save those annotations to a local daemon on their own machine.

## Permission justifications

- `activeTab`: lets the toolbar button or keyboard shortcut act on the current tab only, after the user invokes it. Also allows capturing the visible tab for screenshot comments.
- `scripting`: injects the commenting overlay into the active tab when the user invokes the extension.
- `storage`: remembers the pairing token for the local daemon and which project folder each site maps to. Stored locally and never synced.
- Host permission `http://127.0.0.1:4317/*`: talks to the local daemon on the user's own machine. No other host is contacted.
- `externally_connectable` for `http://127.0.0.1/*`: lets the daemon's pairing page, which the user opens and confirms, hand the extension its token. No website can reach the extension.

## Remote code

None. All code is bundled in the package.

## Assets to prepare

- Icon 128x128: `icons/icon-128.png`.
- At least one 1280x800 screenshot of the overlay on a page and one of the project-mapping card.
- Privacy policy: publish `privacy-policy.md` at a public URL and enter it in the dashboard.

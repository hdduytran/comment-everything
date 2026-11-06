# Comment Everything extension: privacy statement

Comment Everything does not collect, transmit, or sell any data to the developers or to any third party. The extension has no remote servers, no accounts, no analytics, and no advertising.

## What the extension handles

- The text you write and the page elements, text, or screenshots you select while commenting.
- The URL of the page you comment on, used as the comment's source.
- A pairing token for your local daemon, and your choice of project folder per website.

## Where it goes

- Comments, URLs, and screenshots are sent only to the daemon running on your own computer at `127.0.0.1` (default port 4317), which writes them to files on your disk. Nothing is sent over the internet by the extension.
- The pairing token and the site-to-project mapping are kept in the extension's local storage (`chrome.storage.local`) on your device. They are not synced to your Google account.
- If you pass comments to an AI agent, that is done by your own tools (for example Claude Code reading the local files) under their own privacy terms. The extension does not do it.

## What the extension does not do

- It does not read or modify any page until you click the toolbar button or use the keyboard shortcut on that tab.
- It does not run in the background on pages, track browsing, or read page content you did not select.
- It does not load or execute remote code.

## Controls

- Remove the extension to delete its stored token and mappings.
- Delete the `.comments/` folder (or `~/.comment-everything/`) to delete saved comments.

## Contact

Open an issue at the project's GitHub repository.

First release of Comment Everything: comment on HTML, Markdown, live web pages, and video or audio time ranges, then hand the comments to Claude.

## Install

- **Claude Desktop:** download `comment-everything-0.1.0.mcpb` below and double-click it. No Node.js needed.
- **Claude Code:** `/plugin marketplace add hdduytran/comment-everything`, then `/plugin install comment-everything@comment-everything`.
- **CLI:** `npx comment-everything open <file>` opens a file in the comment viewer.
- **Chrome extension:** unzip `comment-everything-extension-0.1.0.zip`, open `chrome://extensions`, enable Developer mode, then Load unpacked. Works on its own (comments stay in the browser, Export or Copy prompt to hand them to Claude) or paired with the local service for automatic Send.

## Highlights

- Multi-select comments on elements, text and screenshot regions; Markdown comments carry exact line ranges.
- Video and audio: pick time ranges on a waveform; each comment gets three keyframes, optional Whisper transcript.
- Comments follow edits: re-anchored after the file changes, detached ones are flagged.
- MCP tools `list_comments`, `get_comment`, `resolve_comment`, `set_status`, `wait_for_comments`; `/comments` and `/comments-watch` in Claude Code.
- Local only: service on 127.0.0.1 with a token, paired extensions, sandboxed HTML preview.

See the README for details and known limitations.

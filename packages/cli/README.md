# comment-everything

Comment on HTML, Markdown, live web pages, video and audio, then hand the comments to Claude Code or any MCP agent.

```sh
npx comment-everything open ./page.html     # opens the viewer; select things, comment, press Send
claude mcp add comment-everything -- npx -y comment-everything mcp
```

Then tell the agent: "check my comments".

Run `npx comment-everything --help` for all commands (`open`, `serve`, `mcp`, `stop`, `init`).

Requires Node 20 or newer. ffmpeg (keyframes) and whisper.cpp (transcripts) are optional.

Full documentation, security model and the Chrome extension: https://github.com/<owner>/comment-everything

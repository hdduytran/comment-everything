# Phase 7 — Claude integration: plugin, Desktop config, push

## Requirements
- Claude Code plugin (`packages/plugin`): `.mcp.json` (stdio `npx comment-everything mcp`), skill `comment-everything` explaining workflow (list open → act → resolve with note), command `/comments` ("process all open comments for this project").
- "Send → Claude works automatically":
  - Verify Claude Code push options (channels / MCP notifications) in current version; implement if available.
  - Fallback: skill instructs Claude to loop `wait_for_comments` when user says "watch comments".
- Claude Desktop: documented `claude_desktop_config.json` snippet; pull-based ("check my comments").
- `comment-everything init`: adds `.comments/` note to README/.gitignore choice, prints setup commands for Claude Code/Desktop/Cursor/Codex.

## Validation
- Manual script: open fixture, comment, Send, Claude Code resolves all comments and edits file; recorded for demo.
- Works with at least one non-Claude MCP client (Cursor or Codex).

## Unresolved
Push availability in Claude Code — decide implementation after verification.

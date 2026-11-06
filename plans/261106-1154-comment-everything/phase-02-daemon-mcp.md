# Phase 2 — Daemon, security, MCP server

## Requirements
- Node HTTP server (Hono or Fastify) on fixed default port (e.g. 4317), bind `127.0.0.1` only.
- Single instance per machine: lockfile `~/.comment-everything/daemon.json` (pid, port, token); reuse if alive, never auto-increment port.
- Security:
  - Per-install random token, required on every API call (header). Viewer gets it via served page; extension via one-time pairing.
  - Origin check: allow only daemon origin and extension origin.
  - File serving restricted to registered project roots; reject path traversal and symlinks escaping root.
- REST: `POST /comments` (batch), `GET /comments?source=&status=`, `PATCH /comments/:id`, `GET /events` (SSE for live updates), `GET /files/*` (scoped).
- MCP server (official `@modelcontextprotocol/sdk`), stdio mode (`comment-everything mcp`) proxying to daemon, plus Streamable HTTP endpoint `/mcp`.
  - Tools: `list_comments(source?, status?)`, `get_comment(id)` (returns image content for keyframes/screenshots), `resolve_comment(id, note)`, `set_status(id, status)`, `wait_for_comments(timeoutSec)` (long-poll for next Send batch).
  - Resources: `comments://open` list.
- Job runner for ffmpeg/whisper tasks (used by phase 4).

## Files
`packages/daemon/src/{http-server,auth-token-and-origin-guard,project-root-registry,scoped-file-server,comment-events-sse,mcp-server-tools,daemon-lockfile}.ts`, `packages/cli/src/{cli,open-command,mcp-command,serve-command}.ts`.

## Validation
- Tests: token missing → 401; foreign Origin → 403; `../` traversal → 403; MCP tools via SDK client in-process.
- Manual: `claude mcp add comment-everything -- npx comment-everything mcp` then `list_comments` works.

## Risk
Prompt injection: comment text from a web page is untrusted → MCP tool output wraps comment text clearly as user-authored data.

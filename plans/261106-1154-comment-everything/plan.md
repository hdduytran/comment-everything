---
title: Comment Everything — MVP
status: done
created: 2026-11-06
---

# Comment Everything — MVP plan

Open-source tool to comment on HTML, Markdown, live web pages, and video/audio time ranges, then hand those comments to Claude Code / Claude Desktop (and any MCP agent) to act on.

## Outcome
User opens a file (`npx comment-everything open <file>`) or a live page (extension), selects multiple regions or time ranges, writes comments, presses **Send**. The agent receives each comment with path/url + anchor (selector / line / timestamp) + keyframes/transcript, does the work, and marks comments resolved.

## Done means
- `npx comment-everything open <file>` opens HTML / MD / video / audio with multi-select commenting.
- Extension (Chrome MV3) comments on live web pages.
- Comments saved as W3C Web Annotation–style JSON, one file per comment, in `<project>/.comments/` (web outside a project: `~/.comment-everything/`).
- MCP tools `list_comments`, `get_comment`, `resolve_comment`, `wait_for_comments` work in Claude Code and Claude Desktop.
- Video comments include keyframes; audio/video comments include transcript when whisper is available.
- Copy prompt button produces a self-contained Markdown prompt.
- Claude Code plugin (MCP + skill + `/comments`) installs in one step.
- README with demo GIF for both flows; MIT license; CONTRIBUTING.

## Non-goals
Accounts, cloud sync, realtime multi-user, custom video editor, Safari/Firefox (later).

## Constraints
- TypeScript monorepo (pnpm workspaces).
- Daemon binds `127.0.0.1` only, per-install token, Origin check, file access limited to opened project root.
- HTML/MD and media ship in the same release.
- Requires ffmpeg for keyframes (graceful message when missing).

## Architecture
```
packages/
  core/        schema, storage, anchoring/re-anchoring, prompt formatter
  daemon/      HTTP API + static viewer + MCP server (stdio & HTTP) + ffmpeg/whisper jobs
  overlay/     shared comment UI (selection, multi-select, comment panel)
  viewer/      local viewer app: html (iframe), md (line-mapped), media (wavesurfer)
  extension/   Chrome MV3, injects overlay, talks to daemon
  cli/         `comment-everything` bin: open, serve, mcp, init
  plugin/      Claude Code plugin: .mcp.json, skill, /comments command
```

## Phases
| # | Phase | Depends on | Status |
|---|-------|-----------|--------|
| 1 | [Monorepo + core schema & storage](phase-01-core-schema-storage.md) | — | done |
| 2 | [Daemon, security, MCP server](phase-02-daemon-mcp.md) | 1 | done |
| 3 | [Overlay + HTML/MD viewer + Copy prompt](phase-03-overlay-html-md-viewer.md) | 2 | done |
| 4 | [Media viewer: video/audio ranges, keyframes, transcript](phase-04-media-viewer.md) | 2, 3 (overlay panel) | done |
| 5 | [Re-anchoring after file changes](phase-05-reanchoring.md) | 3 | done |
| 6 | [Chrome extension](phase-06-extension.md) | 3 | done |
| 7 | [Claude integration: plugin, Desktop config, push](phase-07-claude-integration.md) | 2 | done |
| 8 | [Docs, demo, release](phase-08-docs-release.md) | all | done |

Phases 4, 5, 6, 7 can run in parallel after their dependencies (separate packages).

## Success metrics
- Install → first comment resolved by Claude: < 5 min.
- ≥ 90% HTML/MD comments still anchored correctly after AI edits (fixture test suite).
- Video timestamp accuracy ±0.1 s.
- 500 GitHub stars in first 3 months.

## Risks
- Claude Desktop cannot receive pushed messages → pull-only UX there (documented).
- Claude Code push channel availability unverified → fallback `wait_for_comments` long-poll tool.
- Scope (two flows at once) → if media slips past ~6 weeks, ship media first as differentiator (needs user decision).

## Unresolved questions
- Final package/npm name availability (`comment-everything`).
- Whether Claude Code channels/notification push is usable in the target version (verify in phase 7).

## Status notes (phase 8)

All eight phases are implemented and merged. Release preparation is done; nothing has been published.

Remaining before launch (manual, needs accounts or decisions):
- Replace the `hdduytran` placeholder (README, `packages/cli/package.json`, `packages/cli/README.md`, CONTRIBUTING, plugin install text) with the real GitHub org/repo.
- Confirm the `comment-everything` npm name is free, then `pnpm release` (see CONTRIBUTING, "Releasing").
- Chrome Web Store: run `pnpm --filter @comment-everything/extension zip`, add 1280x800 screenshots, host the privacy statement, submit.
- Claude plugin marketplace listing, GitHub release, good-first-issue labels, launch posts (Show HN, r/ClaudeAI, X).
- Time the fresh-machine quickstart (< 5 min target) after the npm package is live.

Known concerns:
- Token in the sandboxed iframe's file URL is readable by the viewed page's own scripts (documented in README and docs/architecture.md); a per-frame, file-scoped capability would remove it.
- `MCP_SERVER_VERSION` in the daemon is a constant; keep it in step with the CLI version when changesets bump it.
- LoopIn could not be verified from public sources, so the README comparison table covers Vibe Annotations, Claudback and Frame.io only.
- Channel push still needs `--dangerously-load-development-channels` (research preview).
- Code of Conduct has no dedicated contact address yet.

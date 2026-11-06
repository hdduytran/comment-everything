# Claude Code push + plugin research (2026-11-06)

Sources: code.claude.com/docs/en/channels-reference, plugins-reference, plugin-marketplaces.

## Push into a running session: "channels" (supported, research preview)
- An MCP stdio server declares `capabilities.experimental['claude/channel'] = {}` and emits
  `notifications/claude/channel` with `{content: string, meta?: Record<string,string>}`.
  Claude sees `<channel source="<server name>" key="val">content</channel>`. Meta keys: letters/digits/underscore only.
- Gating: the session must opt in. Not on the approved allowlist (only claude-plugins-official channel
  plugins), so custom channels need `claude --dangerously-load-development-channels server:<name>`
  (or `plugin:<name>@<marketplace>`). Interactive only (ignored with `-p`/Agent SDK). Shows a
  confirmation dialog. Team/Enterprise orgs need `channelsEnabled` policy.
- Without opt-in the server works normally but events are dropped silently.
- Events queue while Claude is busy and are delivered together on the next turn.
- Plugin manifest can bind a channel to an MCP server via `channels: [{server, ...}]`; still needs the dev flag.

Decision: implemented as opt-in `comment-everything mcp --channel` (declares the capability, claims
Send batches from the daemon and pushes them). Default plugin `.mcp.json` does not enable it, because
(a) it needs a dev flag, (b) it consumes the batch queue so `wait_for_comments` would starve, (c) it is
research preview. Default path stays pull (`/comments`) + loop (`/comments-watch` using `wait_for_comments`).

## Plugin structure
- `.claude-plugin/plugin.json` (only `name` required; kebab-case; names starting `claude-`/`anthropic-` rejected).
- Components at plugin root, NOT inside `.claude-plugin/`: `skills/<name>/SKILL.md`, `commands/*.md`
  (flat; skills preferred for new plugins), `.mcp.json` (`{mcpServers:{...}}`), `agents/`, `hooks/hooks.json`.
- `${CLAUDE_PLUGIN_ROOT}` etc. available in MCP command/args/env. Commands appear namespaced: `/comment-everything:comments`.
- `claude plugin validate <dir>` is the authoritative check (not run here: CLI not invoked in this environment; tests check JSON shape).

## Marketplace
- Repo-root `.claude-plugin/marketplace.json`: required `name`, `owner{name}`, `plugins[]`; each entry needs
  `name` + `source`. Relative `source` is relative to the marketplace root and must start with `./`, no `..`.
  Entry name must equal manifest name.
- Users: `/plugin marketplace add <owner>/<repo>` then `/plugin install comment-everything@comment-everything`
  (CLI: `claude plugin marketplace add`, `claude plugin install`).
- Repo marketplace name must not be a reserved Anthropic name (we use `comment-everything`).

## Unresolved
- `<owner>` in the install instructions is a placeholder until the repo is published (phase 8).
- Plugin `.mcp.json` uses `npx -y comment-everything`: requires the npm package to be published.

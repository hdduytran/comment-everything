import { MCP_SERVER_ENTRY, MCP_SERVER_KEY } from './claude-desktop-config.js';

const snippet = JSON.stringify({ mcpServers: { [MCP_SERVER_KEY]: MCP_SERVER_ENTRY } }, null, 2);
const indent = (text: string) =>
  text
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');

/** Setup instructions printed by `comment-everything init` (pure, so it can be snapshot-tested). */
export function renderSetupText(opts: { desktopConfigPath: string }): string {
  return `Connect your AI agent to comment-everything

Claude Code (plugin: MCP server + skill + /comments and /comments-watch)
    /plugin marketplace add <owner>/comment-everything
    /plugin install comment-everything@comment-everything

Claude Code (MCP server only)
    claude mcp add comment-everything -- npx -y comment-everything mcp

  Optional push (research preview, interactive sessions only): sent comments appear in the
  session without asking Claude to wait. Register the channel variant and start Claude with:
    claude mcp add comment-everything-channel -- npx -y comment-everything mcp --channel
    claude --dangerously-load-development-channels server:comment-everything-channel

Claude Desktop (${opts.desktopConfigPath})
  Add this to the file, keeping any servers already there, then restart Claude Desktop
  (or run: comment-everything init --write-desktop-config):
${indent(snippet)}
  Desktop is pull-based: say "check my comments".

Cursor (.cursor/mcp.json in the project, or ~/.cursor/mcp.json)
${indent(snippet)}

Codex (~/.codex/config.toml)
    [mcp_servers.${MCP_SERVER_KEY}]
    command = "npx"
    args = ["-y", "comment-everything", "mcp"]

Then run: comment-everything open <file>, add comments and press Send.
`;
}

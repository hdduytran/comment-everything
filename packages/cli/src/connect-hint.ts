/** Shown by `serve` and `open` until some MCP client has connected to this install. */
export const CONNECT_HINT = [
  'Next: connect Claude so it can read your comments.',
  '  Claude Code:    claude mcp add comment-everything -- comment-everything mcp',
  '  Claude Desktop: comment-everything init --write-desktop-config',
].join('\n');

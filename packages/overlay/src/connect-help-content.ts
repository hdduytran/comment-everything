/** Copy for the "Connect to Claude" sheet. Short and literal; commands are copied verbatim. */
export interface HelpStep {
  text: string;
  /** A command or slash command with a copy button. */
  command?: string;
}

export interface HelpTab {
  id: 'code' | 'desktop' | 'other';
  label: string;
  steps: HelpStep[];
}

export const HELP_TABS: readonly HelpTab[] = [
  {
    id: 'code',
    label: 'Claude Code',
    steps: [
      {
        text: 'Add the server to Claude Code:',
        command: 'claude mcp add comment-everything -- comment-everything mcp',
      },
      {
        text: 'Or install the plugin (add this repo as a marketplace first):',
        command: '/plugin install comment-everything@comment-everything',
      },
      { text: 'After Send, read the comments once:', command: '/comments' },
      {
        text: 'Or keep Claude listening, so each Send is picked up automatically:',
        command: '/comments-watch',
      },
    ],
  },
  {
    id: 'desktop',
    label: 'Claude Desktop',
    steps: [
      {
        text: 'Add the server to Claude Desktop’s config, then restart the app:',
        command: 'comment-everything init --write-desktop-config',
      },
      { text: 'After Send, say: “check my comments”.' },
    ],
  },
  {
    id: 'other',
    label: 'Other MCP',
    steps: [
      { text: 'Register this stdio server in any MCP client:', command: 'comment-everything mcp' },
      {
        text: 'Print ready-made snippets for Cursor, Codex and others:',
        command: 'comment-everything init',
      },
      { text: 'After Send, ask the agent to check your comments.' },
    ],
  },
];

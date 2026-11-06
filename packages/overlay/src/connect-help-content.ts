/** Copy for the "Connect to Claude" sheet. Short and literal; commands are copied verbatim. */
export interface HelpStep {
  text: string;
  /** A command or slash command with a copy button. */
  command?: string;
}

export interface HelpTab {
  id: 'standalone' | 'code' | 'desktop' | 'other';
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

/** First tab when the extension runs without a daemon. */
export const STANDALONE_HELP_TAB: HelpTab = {
  id: 'standalone',
  label: 'Extension only',
  steps: [
    {
      text: 'No install needed. Three ways to hand your comments to Claude:',
    },
    {
      text: '1. Copy prompt: paste it into Claude Desktop, claude.ai or any chat. Screenshots come along where the app accepts pasted images.',
    },
    {
      text: '2. Export: saves comments.md, comments.json and screenshots under Downloads/comment-everything/. Then tell Claude Code to read the comments.md it names.',
    },
    {
      text: '3. Open in Claude: copies the prompt, then opens a blank claude.ai chat. Paste it there. Nothing is put in the address.',
    },
    {
      text: 'Want Send to reach Claude by itself? Switch to daemon mode. Install the CLI:',
      command: 'npm install -g comment-everything',
    },
    { text: 'Start it and leave it running:', command: 'comment-everything serve' },
    {
      text: 'Once it is running, this panel offers to pair with it. Comments saved here can then be moved to your project.',
    },
  ],
};

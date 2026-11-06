import { parseArgs } from 'node:util';
import { mcpCommand } from './mcp-command.js';
import { openCommand } from './open-command.js';
import { serveCommand } from './serve-command.js';

const HELP = `comment-everything — comment on files and pages, hand the comments to an AI agent

Usage:
  comment-everything open <file> [--no-open] [--port <n>]   Open a file in the viewer
  comment-everything serve [--port <n>]                      Run the local daemon in the foreground
  comment-everything mcp [--port <n>]                        MCP server over stdio (proxies to the daemon)

Register with Claude Code:
  claude mcp add comment-everything -- npx comment-everything mcp
`;

/** Parse argv and dispatch to a command; resolves to the process exit code. */
async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      'no-open': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    console.log(HELP);
    return command || values.help ? 0 : 1;
  }

  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    console.error(`Invalid --port: ${values.port}`);
    return 1;
  }

  switch (command) {
    case 'serve':
      return serveCommand({ port });
    case 'mcp':
      return mcpCommand({ port });
    case 'open': {
      if (rest.length !== 1) {
        console.error('Usage: comment-everything open <file>');
        return 1;
      }
      await openCommand(rest[0] as string, { port, noOpen: values['no-open'] });
      return 0;
    }
    default:
      console.error(`Unknown command: ${command}\n\n${HELP}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`comment-everything: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);

import type { AgentClientSummary, AgentsStatus } from './host-adapter.js';

/** What the connection indicator in the panel header shows. */
export interface AgentIndicator {
  kind: 'watching' | 'connected' | 'none' | 'local';
  label: string;
  tip: string;
}

/** What to tell the user after Send; `connect` adds a "How to connect" button. */
export interface SendOutcome {
  text: string;
  action?: 'connect';
}

const FRIENDLY: Record<string, string> = {
  'claude-code': 'Claude Code',
  'claude-ai': 'Claude',
  'claude-desktop': 'Claude',
};

/** Product name for an MCP `clientInfo.name`; unknown names are shown as reported. */
export function agentDisplayName(name: string): string {
  return FRIENDLY[name.toLowerCase()] ?? name;
}

/** The client that matters most: one that is watching, else the most recently seen. */
function primary(status: AgentsStatus): AgentClientSummary | undefined {
  return status.connected.find((c) => c.watching) ?? status.connected[0];
}

/** `null` status means the host cannot report it (no indicator is shown). */
export function describeAgents(status: AgentsStatus | null): AgentIndicator | null {
  if (!status) return null;
  const who = primary(status);
  if (!who) {
    return {
      kind: 'none',
      label: 'No AI connected',
      tip: 'No AI agent is connected yet. Comments are still saved. Select to see how to connect Claude.',
    };
  }
  const name = agentDisplayName(who.name);
  if (status.watching) {
    return {
      kind: 'watching',
      label: `${name} connected · watching`,
      tip: `${name} is waiting for comments and picks up each Send right away.`,
    };
  }
  return {
    kind: 'connected',
    label: `${name} connected (will read on request)`,
    tip: `${name} can read your comments but is not waiting for them. After Send, tell it to check your comments or run /comments.`,
  };
}

export function describeSendOutcome(status: AgentsStatus | null, count: number): SendOutcome {
  if (!status) return { text: `Sent ${count} comment${count === 1 ? '' : 's'}.` };
  if (status.watching) return { text: 'Sent — Claude is picking it up' };
  if (status.connected.length > 0) {
    return { text: "Sent. In Claude, run /comments (or say 'check my comments')" };
  }
  return { text: 'Saved. Connect Claude:', action: 'connect' };
}

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pluginDir = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const repoFile = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const read = (file: string) => readFileSync(file, 'utf8');
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe('claude plugin package', () => {
  it('has a valid manifest', () => {
    const m = readJson(pluginDir('.claude-plugin/plugin.json'));
    expect(m.name).toMatch(KEBAB);
    expect(m.name).not.toMatch(/^(claude|anthropic)/);
    expect(typeof m.description).toBe('string');
    expect(typeof m.version).toBe('string');
    expect(typeof m.author?.name).toBe('string');
  });

  it('declares the stdio MCP server via npx', () => {
    const mcp = readJson(pluginDir('.mcp.json'));
    expect(mcp.mcpServers['comment-everything']).toEqual({
      command: 'npx',
      args: ['-y', 'comment-everything', 'mcp'],
    });
  });

  it('ships the skill with frontmatter and the untrusted-data rule', () => {
    const skill = read(pluginDir('skills/comment-everything/SKILL.md'));
    expect(skill).toMatch(/^---\nname: comment-everything\ndescription: .+\n---\n/);
    expect(skill).toContain('<untrusted_user_comment>');
    for (const tool of ['list_comments', 'get_comment', 'resolve_comment', 'wait_for_comments']) {
      expect(skill).toContain(tool);
    }
  });

  it.each(['comments', 'comments-watch'])('ships the /%s command', (name) => {
    const cmd = read(pluginDir(`commands/${name}.md`));
    expect(cmd).toMatch(/^---\ndescription: .+\n---\n/);
    expect(cmd).toContain('comment-everything');
  });

  it('is listed by the repo-root marketplace under the same name', () => {
    const market = readJson(repoFile('.claude-plugin/marketplace.json'));
    const manifest = readJson(pluginDir('.claude-plugin/plugin.json'));
    expect(market.name).toMatch(KEBAB);
    expect(typeof market.owner?.name).toBe('string');
    expect(market.plugins).toHaveLength(1);
    const [entry] = market.plugins;
    expect(entry.name).toBe(manifest.name);
    expect(entry.source).toBe('./packages/plugin');
    expect(() => readJson(repoFile(`${entry.source}/.claude-plugin/plugin.json`))).not.toThrow();
  });
});

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { desktopConfigPath, mergeDesktopConfig } from '../src/claude-desktop-config.js';
import { ASSETS_IGNORE_LINE, initCommand } from '../src/init-command.js';
import { renderSetupText } from '../src/init-setup-text.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ce-init-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('desktopConfigPath', () => {
  it('resolves the per-OS location', () => {
    expect(desktopConfigPath('darwin', {}, '/h')).toBe(
      '/h/Library/Application Support/Claude/claude_desktop_config.json',
    );
    expect(desktopConfigPath('linux', {}, '/h')).toBe(
      '/h/.config/Claude/claude_desktop_config.json',
    );
    expect(desktopConfigPath('win32', { APPDATA: 'C:\\A' }, 'C:\\h')).toContain(
      'claude_desktop_config.json',
    );
  });
});

describe('mergeDesktopConfig', () => {
  it('backs up the file and keeps other servers and settings', async () => {
    const file = path.join(dir, 'claude_desktop_config.json');
    const original = {
      theme: 'dark',
      mcpServers: { other: { command: 'node', args: ['x.js'] } },
    };
    await writeFile(file, JSON.stringify(original));

    const res = await mergeDesktopConfig(file, new Date('2026-11-06T00:00:00Z'));
    expect(res.changed).toBe(true);
    expect(res.backup).toContain('.bak-2026-11-06');
    expect(JSON.parse(await readFile(res.backup as string, 'utf8'))).toEqual(original);

    const merged = JSON.parse(await readFile(file, 'utf8'));
    expect(merged.theme).toBe('dark');
    expect(merged.mcpServers.other).toEqual(original.mcpServers.other);
    expect(merged.mcpServers['comment-everything']).toEqual({
      command: 'npx',
      args: ['-y', 'comment-everything', 'mcp'],
    });
  });

  it('creates the file (and directories) when missing, with no backup', async () => {
    const file = path.join(dir, 'nested', 'Claude', 'claude_desktop_config.json');
    const res = await mergeDesktopConfig(file);
    expect(res).toMatchObject({ changed: true, backup: null });
    expect(JSON.parse(await readFile(file, 'utf8')).mcpServers['comment-everything']).toBeDefined();
  });

  it('is a no-op when already configured', async () => {
    const file = path.join(dir, 'c.json');
    await mergeDesktopConfig(file);
    const again = await mergeDesktopConfig(file);
    expect(again.changed).toBe(false);
    expect((await readdir(dir)).filter((f) => f.includes('.bak-'))).toHaveLength(0);
  });

  it('refuses invalid JSON without modifying it', async () => {
    const file = path.join(dir, 'c.json');
    await writeFile(file, '{ not json');
    await expect(mergeDesktopConfig(file)).rejects.toThrow('not valid JSON');
    expect(await readFile(file, 'utf8')).toBe('{ not json');
    expect(await readdir(dir)).toEqual(['c.json']);
  });
});

describe('init', () => {
  it('prints stable setup instructions', () => {
    expect(renderSetupText({ desktopConfigPath: '<DESKTOP_CONFIG>' })).toMatchSnapshot();
  });

  it('keeps assets tracked by default and does not touch .gitignore', async () => {
    const out = await initCommand({ cwd: dir, desktopConfigFile: path.join(dir, 'd.json') });
    expect(out).toContain('stay tracked');
    expect(out).toContain('claude mcp add comment-everything -- npx -y comment-everything mcp');
    expect(await readdir(dir)).toEqual([]);
  });

  it('--gitignore-assets appends once, preserving existing content', async () => {
    await writeFile(path.join(dir, '.gitignore'), 'node_modules');
    const opts = { cwd: dir, gitignoreAssets: true, desktopConfigFile: path.join(dir, 'd.json') };
    await initCommand(opts);
    await initCommand(opts);
    expect(await readFile(path.join(dir, '.gitignore'), 'utf8')).toBe(
      `node_modules\n${ASSETS_IGNORE_LINE}\n`,
    );
  });

  it('--write-desktop-config merges into the given file only', async () => {
    const file = path.join(dir, 'Claude', 'claude_desktop_config.json');
    await mkdir(path.dirname(file));
    await writeFile(file, JSON.stringify({ mcpServers: { keep: { command: 'x' } } }));
    const out = await initCommand({ cwd: dir, writeDesktopConfig: true, desktopConfigFile: file });
    expect(out).toContain('backup:');
    const merged = JSON.parse(await readFile(file, 'utf8'));
    expect(Object.keys(merged.mcpServers).sort()).toEqual(['comment-everything', 'keep']);
  });
});

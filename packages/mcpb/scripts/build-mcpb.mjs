// Builds release/comment-everything-<version>.mcpb for Claude Desktop.
// Steps: npm-pack the built CLI, unpack it into a staging folder as server/,
// install its production dependencies there, add manifest + icon, then `mcpb pack`.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, '..');
const repoRoot = resolve(pkgDir, '../..');
const cliDir = join(repoRoot, 'packages/cli');
const releaseDir = join(pkgDir, 'release');

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

const cliPkg = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(pkgDir, 'manifest.json'), 'utf8'));
if (manifest.version !== cliPkg.version) {
  // Keep the bundle version in step with the CLI it ships.
  manifest.version = cliPkg.version;
}

const work = mkdtempSync(join(tmpdir(), 'ce-mcpb-'));
const stage = join(work, 'bundle');
mkdirSync(stage, { recursive: true });

try {
  run('npm', ['pack', '--pack-destination', work], cliDir);
  const tarball = join(work, `${cliPkg.name}-${cliPkg.version}.tgz`);
  run('tar', ['-xzf', tarball, '-C', work]);
  // npm pack unpacks to ./package. Keep the same layout under server/ (build output
  // next to its package.json), because the CLI reads its version from ../package.json.
  const buildDir = 'dist';
  cpSync(join(work, 'package', buildDir), join(stage, 'server', buildDir), { recursive: true });

  const serverPkg = {
    name: cliPkg.name,
    version: cliPkg.version,
    private: true,
    type: cliPkg.type ?? 'module',
    dependencies: cliPkg.dependencies,
  };
  writeFileSync(join(stage, 'server', 'package.json'), JSON.stringify(serverPkg, null, 2));
  run(
    'npm',
    ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'],
    join(stage, 'server'),
  );

  writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
  cpSync(join(repoRoot, 'packages/extension/icons/icon-128.png'), join(stage, 'icon.png'));
  cpSync(join(repoRoot, 'LICENSE'), join(stage, 'LICENSE'));

  run('npx', ['-y', '@anthropic-ai/mcpb', 'validate', join(stage, 'manifest.json')], stage);
  mkdirSync(releaseDir, { recursive: true });
  const out = join(releaseDir, `comment-everything-${cliPkg.version}.mcpb`);
  rmSync(out, { force: true });
  run('npx', ['-y', '@anthropic-ai/mcpb', 'pack', stage, out], stage);
  console.log(`\nBuilt ${out}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

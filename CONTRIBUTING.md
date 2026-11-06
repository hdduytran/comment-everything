# Contributing

Thanks for helping. Bug reports, docs fixes and small features are all welcome; for anything big, open an issue first so we can agree on the approach.

## Setup

Requirements: Node 20+, pnpm 10 (`corepack enable`), optional ffmpeg for the media tests.

```sh
git clone https://github.com/hdduytran/comment-everything.git
cd comment-everything
pnpm install
pnpm -r build
```

## Layout

See [docs/architecture.md](docs/architecture.md). In short: `core` (schema, storage, re-anchoring), `daemon` (HTTP, MCP), `overlay` and `viewer` (browser UI), `cli` (the published package), `extension` (Chrome), `plugin` (Claude Code), `e2e` (Playwright).

## Checks

Run these before opening a pull request; CI runs the same on Node 20 and 22.

```sh
pnpm -r build
pnpm -r typecheck
pnpm lint
pnpm -r test
pnpm exec playwright install chromium   # once, in packages/e2e
pnpm e2e
```

Format with `pnpm format`. The e2e suite drives the built CLI, so build first.

## Pull requests

- Keep a PR to one change. Add or update tests for new behavior; fix the code rather than weakening a test.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
- Changes to the published `comment-everything` package need a changeset: run `pnpm changeset`, pick the bump, describe the change for users.
- Changes to the comment file format must keep reading old files, or bump `schemaVersion` with a migration, and update `docs/schema-reference.md`.
- Anything touching the daemon's guards (token, Host, Origin, file scoping, sandboxing) needs a test for the failure case, not just the happy path.

## Security issues

Do not open a public issue for a vulnerability. Use GitHub's private vulnerability reporting on the repository's Security tab.

## Releasing (maintainers)

Nothing publishes automatically.

1. `pnpm changeset version` to bump `comment-everything` and update the changelog; review and commit.
2. `pnpm -r build && pnpm -r test && pnpm e2e`.
3. Verify the package: `pnpm --filter comment-everything pack --pack-destination /tmp/ce-pack`, install the tarball in an empty directory with `npm install`, and run `npx comment-everything --version` and `comment-everything open <file> --no-open`.
4. `pnpm release` (builds, then `changeset publish`) with an npm token that can publish `comment-everything`; tag and create the GitHub release.
5. Chrome extension: bump `version` in `packages/extension/manifest.json`, run `pnpm --filter @comment-everything/extension zip`, and upload `packages/extension/release/comment-everything-extension-<version>.zip` in the Chrome Web Store dashboard. Listing text and the privacy statement are in `packages/extension/store/`.
6. Claude Code plugin: users install from this repository's `.claude-plugin/marketplace.json`; the plugin's MCP entry runs `npx -y comment-everything mcp`, so publish the npm package first.

## Good first issues

Look for the `good first issue` label. Typical starters: more fixtures for the re-anchoring suite, Markdown rendering edge cases, docs and examples for other MCP clients.

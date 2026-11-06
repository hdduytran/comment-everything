## What and why

<!-- One or two sentences. Link the issue. -->

## Checklist

- [ ] `pnpm -r build && pnpm -r typecheck && pnpm lint && pnpm -r test` pass
- [ ] `pnpm e2e` passes (if viewer, overlay, daemon or CLI behavior changed)
- [ ] Tests cover the new behavior, including a failure case
- [ ] Changeset added if the published `comment-everything` package changed (`pnpm changeset`)
- [ ] Docs updated if behavior, commands, the comment schema or the security model changed

# Changesets

Add a changeset for every user-visible change to the published `comment-everything` package:

```sh
pnpm changeset
```

Internal packages (`@comment-everything/*`) are private and bundled into the CLI, so they are never published on their own. See `CONTRIBUTING.md` for the release steps.

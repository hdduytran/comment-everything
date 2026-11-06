# REST API

The daemon serves a JSON API on `http://127.0.0.1:4317` (default port; `--port <n>` to change, `--port 0` for a free port). The viewer, the Chrome extension, the CLI and the MCP stdio proxy all use it. It is local infrastructure for those clients; the MCP tools in [mcp-tools.md](mcp-tools.md) are the supported agent interface.

## Authentication

Every route except those listed under "Public routes" needs the per-install token, one of:

- `x-ce-token: <token>` header
- `Authorization: Bearer <token>`
- `?token=<token>` query parameter on `GET` requests (for `EventSource`, which cannot set headers)
- `/s/<token>/files/...` path prefix for file reads (keeps relative URLs inside served HTML working)

The token lives in `~/.comment-everything/token` (mode 0600), and in `~/.comment-everything/daemon.json` together with the pid and port of the running daemon. Requests must also pass the guards described in [architecture.md](architecture.md#threat-model): `Host` must be `127.0.0.1:<port>` or `localhost:<port>`, and a browser `Origin` must be the daemon itself or a paired `chrome-extension://` origin.

Errors are JSON: `{ "error": "<code>", "message": "..." }` with status 400 `invalid_request`, 401 `unauthorized`, 403 `forbidden` / `forbidden_path`, 404 `not_found`, 500 `internal_error`.

## Public routes (no token; Host and Origin still checked)

| Route                            | Purpose                                                                                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                    | `{ ok, version, pid }`.                                                                                                                                                                               |
| `GET /view?path=<absolute file>` | Viewer shell page for a file inside a registered project root. Embeds the token for the viewer's own scripts, so it is sent with `Cache-Control: no-store`, `X-Frame-Options: DENY` and a strict CSP. |
| `GET /_ce/*`                     | Static viewer bundle (code only).                                                                                                                                                                     |
| `GET /pair?ext=<id>`             | Start extension pairing; returns a confirmation page.                                                                                                                                                 |
| `POST /pair/confirm`             | Same-origin only. Consumes the one-time nonce (5 minute lifetime) and returns `{ ext, token, port }`.                                                                                                 |

## Comments

| Route                                                                  | Description                                                                                                                                                                                                          |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /comments`                                                       | Create a batch (the **Send** action). Body below. Responds `201` with `{ batchId, comments }`.                                                                                                                       |
| `GET /comments?source=&status=&root=`                                  | List comments; all filters optional. `{ comments }`.                                                                                                                                                                 |
| `GET /comments/:id`                                                    | One comment (with `root`).                                                                                                                                                                                           |
| `PATCH /comments/:id`                                                  | Partial update: `status`, `resolution`, `text`, `selectors`, `assets`, `transcript`, `anchorState`, `lastResolved`. Unknown fields are rejected.                                                                     |
| `GET /comments/:id/asset?path=assets/<file>`                           | Raw bytes of an asset listed on the comment (`nosniff`).                                                                                                                                                             |
| `POST /comments/assets?root=<project root>` or `?source=<http(s) url>` | Upload a screenshot (raw `image/png`, `image/jpeg` or `image/webp` body, at most 10 MB; the type is sniffed from the bytes). Responds `201 { asset: "assets/<name>" }`, which you then list in a comment's `assets`. |

`POST /comments` body:

```json
{
  "root": "/work/acme",
  "batchId": "optional-client-chosen-id",
  "comments": [
    {
      "source": "landing.html",
      "selectors": [{ "type": "CssSelector", "value": "#cta" }],
      "text": "Say \"Start free\" instead",
      "assets": [],
      "transcript": { "text": "..." }
    }
  ]
}
```

- `root` is required for file sources. For `http(s)` sources it is optional: given, the comments are stored in that project's `.comments/`; omitted, they go to `~/.comment-everything/<host>/`.
- 1 to 200 comments per batch; every comment is validated before any is written, so a bad one never leaves a half-saved batch.
- File sources must be relative paths without `..`.
- Fields are described in [schema-reference.md](schema-reference.md).

Example:

```sh
TOKEN=$(cat ~/.comment-everything/token)
curl -s -H "x-ce-token: $TOKEN" "http://127.0.0.1:4317/comments?status=open"
curl -s -X PATCH -H "x-ce-token: $TOKEN" -H 'content-type: application/json' \
  -d '{"status":"resolved","resolution":"Changed the label"}' \
  http://127.0.0.1:4317/comments/<id>
```

## Batches

`GET /batches/next?timeoutSec=30` long-polls for the next **Send** batch: `200` with `{ batchId, comments }`, or `204` on timeout (`timeoutSec` is clamped to 1 to 600). A batch is claimed by exactly one caller. This is what `wait_for_comments` and the channel push use.

## Agents (who is connected)

The daemon records which MCP clients talk to it, so the viewer can tell you what happens after **Send**.

| Route                | Description                                                                                                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /agents/status` | `{ connected: [{ name, version?, transport, watching, channel, lastSeenAt }], watching, everConnected }`. `name` is the client's own `clientInfo.name` (for example `claude-code`). `watching` is true while a client is blocked in `wait_for_comments` or uses channel push. |
| `POST /agents/hello` | Used by the `mcp` stdio proxy after the MCP handshake and every 30 s: `{ id, name, version?, transport, channel? }`.                                                                                                                                                          |
| `POST /agents/bye`   | `{ id }`. The proxy calls it when the client disconnects.                                                                                                                                                                                                                     |

A stdio client counts as connected for 90 s after its last heartbeat; an HTTP `/mcp` client (told apart by `User-Agent`, since `/mcp` is stateless) for 10 minutes after its last call. Send the `x-ce-agent: <id>` header on `/batches/next` to count the caller as watching. `everConnected` is remembered in `~/.comment-everything/agents-seen.json`.

## Projects (roots)

| Route                       | Description                                                                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /roots`                | Registered project roots: `{ roots: [{ id, root }] }`.                                                                                                                                                            |
| `POST /roots`               | Body `{ "root": "<absolute dir>" }`. Registers a project folder (needed before its files can be served). Too-broad roots (for example the home directory) are refused with `400`.                                 |
| `GET /files/:rootId/<path>` | Serve a file from a root. Paths are resolved with `realpath` and must stay inside the root. Supports `Range`. HTML and SVG get a CSP `sandbox`. With `?ce-frame=1` the viewer's frame agent is spliced into HTML. |

## Events (Server-Sent Events)

`GET /events` streams events as `event: <type>` with a JSON `data` payload:

| Event                                 | Payload                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `comment.created` / `comment.updated` | `{ type, root, comment }`                                                                                                            |
| `comment.deleted`                     | `{ type, root, id }`                                                                                                                 |
| `batch.sent`                          | `{ type, batchId, ids }`                                                                                                             |
| `file.changed`                        | `{ type, root, path }` for files open in the viewer                                                                                  |
| `agents.changed`                      | `{ type, status }` where `status` is the `GET /agents/status` body; sent when a client connects, leaves, or starts or stops watching |

Edits made directly to `.comments/*.json` files on disk are detected and published too.

## Media helpers

| Route                                 | Description                                                                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /media/capabilities`             | `{ ffmpeg, whisper, warnings }`: whether ffmpeg and whisper.cpp (plus a model) were found.                                                                  |
| `GET /media/thumbnails?rootId=&path=` | One JPEG thumbnail strip; geometry in `X-CE-Frames`, `X-CE-Duration`, `X-CE-Thumb-Width`, `X-CE-Thumb-Height` headers. `503 ffmpeg_missing` without ffmpeg. |
| `GET /media/scenes?rootId=&path=`     | `{ cuts: [seconds] }` scene-cut suggestions.                                                                                                                |
| `GET /jobs`, `GET /jobs/:id`          | Background keyframe and transcript jobs started after **Send**.                                                                                             |

Results are cached under `~/.comment-everything/` keyed by file path, size and mtime.

## MCP

`/mcp` is the Streamable HTTP MCP endpoint ([mcp-tools.md](mcp-tools.md)).

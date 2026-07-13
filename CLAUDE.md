# yt-playlist-mcp

## Project

Local stdio MCP server for Claude Desktop: YouTube search + playlist creation
on Sky's personal account. Single user, not published.

## Stack

Node 22 + TypeScript (NodeNext ESM), `@modelcontextprotocol/sdk`, `googleapis`, zod.

## Commands

```sh
npm run build    # tsc → dist/
npm run auth     # one-time browser OAuth flow (needs YOUTUBE_CLIENT_ID/SECRET env vars)
npm start        # run the stdio server directly
npx @modelcontextprotocol/inspector node dist/index.js   # interactive tool testing
```

No tests. Quick protocol check: pipe `initialize` + `tools/list` JSON-RPC lines
into `node dist/index.js`.

## Conventions

- stdout is MCP protocol traffic only — log via `console.error`, never `console.log`,
  anywhere reachable from `src/index.ts`.
- Import Google auth types via `googleapis`'s `Auth` namespace, not directly from
  `google-auth-library` (see gotcha below).
- Tool handlers return `isError: true` results instead of throwing.

## Don't touch

- `~/.config/yt-playlist-mcp/token.json` — live OAuth tokens (outside the repo).

## Gotchas

- Duplicate `google-auth-library` versions under `googleapis` cause opaque
  "separate declarations of a private property" type errors → `npm dedupe`.
- The GCP OAuth consent screen must be **published to production** (unverified is
  fine); Testing status expires refresh tokens after 7 days.
- `search.list` doesn't return durations — `searchVideos` makes a second batched
  `videos.list` call. Live streams report duration `P0D` → rendered as `live`.
- Quota: 10k units/day; each search costs ~101 units, playlist creation 50 + 50/video.
- Claude Desktop launches servers with an unpredictable cwd — all paths in code and
  in `claude_desktop_config.json` must be absolute.

# yt-playlist-mcp

Local MCP server for Claude Desktop that searches YouTube and creates
playlists on your own account.

**Tools**

- `search_youtube(query, max_results)` — video search with title, channel,
  duration, URL
- `create_playlist(title, video_ids[], description?)` — creates a **private**
  playlist and adds the videos in order

Auth is OAuth 2.0 (Desktop-app client): a one-time browser consent flow stores
a refresh token at `~/.config/yt-playlist-mcp/token.json` (mode 600); after
that the server refreshes access tokens silently.

## 1. Google Cloud setup (one time, in the browser)

1. Go to <https://console.cloud.google.com/> and create a new project
   (e.g. `yt-playlist-mcp`).
2. **Enable the API**: APIs & Services → Library → search "YouTube Data API v3"
   → Enable.
3. **OAuth consent screen**: APIs & Services → OAuth consent screen
   (Google may call this "Google Auth Platform → Branding/Audience").
   - User type: **External**
   - App name / support email / developer email: anything (only you will see it)
   - Scopes: you can skip adding scopes here; the app requests
     `https://www.googleapis.com/auth/youtube` at runtime
   - **Publish the app** (Audience → "Publish app" → confirm "In production").
     Leaving it in *Testing* status makes Google expire the refresh token
     every 7 days, forcing you to re-run the auth flow weekly. Published but
     unverified is fine for personal use — you'll click through one
     "Google hasn't verified this app" warning during consent
     (Advanced → "Go to yt-playlist-mcp (unsafe)").
4. **Create credentials**: APIs & Services → Credentials → Create credentials
   → OAuth client ID → Application type: **Desktop app**. Copy the
   **Client ID** and **Client secret**.

## 2. Build and authorize

```sh
npm install
npm run build
YOUTUBE_CLIENT_ID=xxx.apps.googleusercontent.com \
YOUTUBE_CLIENT_SECRET=yyy \
npm run auth
```

`npm run auth` opens your browser; sign in with the Google account whose
YouTube you want to manage, click through the unverified-app warning, and
approve. Tokens land in `~/.config/yt-playlist-mcp/token.json`.

Re-run `npm run auth` any time to re-authorize (e.g. if you revoke access at
<https://myaccount.google.com/permissions>).

## 3. Hook up Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(create it if missing) — use **absolute paths**, since Claude Desktop does not
launch servers from this directory:

```json
{
  "mcpServers": {
    "youtube": {
      "command": "/absolute/path/to/node",
      "args": ["/Users/will/Projects/youtube-mcp/dist/index.js"],
      "env": {
        "YOUTUBE_CLIENT_ID": "xxx.apps.googleusercontent.com",
        "YOUTUBE_CLIENT_SECRET": "yyy"
      }
    }
  }
}
```

(`which node` prints the node path.) Restart Claude Desktop; the two tools
appear under the `youtube` server.

## Quota

The YouTube Data API grants 10,000 units/day by default:

- `search_youtube`: ~101 units per call (search 100 + videos.list 1)
- `create_playlist`: 50 units + 50 per video added

So roughly 90 searches/day, or fewer if you create large playlists. Quota
errors come back as tool errors mentioning `quotaExceeded`.

## Development

```sh
npm run build   # tsc → dist/
npm start       # run the stdio server directly (for inspector/debugging)
npx @modelcontextprotocol/inspector node dist/index.js   # interactive test UI
```

Secrets never live in the repo: client ID/secret come from env vars
(`.env.example` documents them), tokens live under `~/.config/yt-playlist-mcp/`.

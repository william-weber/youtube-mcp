import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { google, type Auth } from "googleapis";

type OAuth2Client = Auth.OAuth2Client;
type Credentials = Auth.Credentials;

export const SCOPES = ["https://www.googleapis.com/auth/youtube"];

export const CONFIG_DIR = path.join(os.homedir(), ".config", "yt-playlist-mcp");
export const TOKEN_PATH = path.join(CONFIG_DIR, "token.json");

export function createOAuthClient(redirectUri?: string): OAuth2Client {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET must be set. " +
        "See README.md for how to create OAuth Desktop-app credentials."
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function saveTokens(tokens: Credentials): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), {
    mode: 0o600,
  });
}

async function loadTokens(): Promise<Credentials> {
  let raw: string;
  try {
    raw = await fs.readFile(TOKEN_PATH, "utf8");
  } catch {
    throw new Error(
      `No stored token at ${TOKEN_PATH}. Run \`npm run auth\` once to ` +
        "authorize this server against your YouTube account."
    );
  }
  return JSON.parse(raw) as Credentials;
}

/**
 * Returns an OAuth2 client with stored credentials. Access-token refresh is
 * handled automatically by googleapis via the refresh token; the `tokens`
 * listener persists any rotated tokens so a re-issued refresh token survives
 * server restarts.
 */
export async function getAuthorizedClient(): Promise<OAuth2Client> {
  const client = createOAuthClient();
  const stored = await loadTokens();
  client.setCredentials(stored);
  client.on("tokens", (tokens) => {
    void saveTokens({ ...stored, ...tokens }).catch((err) => {
      console.error("Failed to persist refreshed tokens:", err);
    });
  });
  return client;
}

#!/usr/bin/env node
/**
 * One-time interactive OAuth flow. Run with `npm run auth`, not via MCP.
 *
 * Starts a loopback HTTP server on an ephemeral port (Google removed the
 * out-of-band flow; Desktop-app clients accept any http://127.0.0.1:<port>
 * redirect without pre-registration), opens the consent screen in the
 * browser, exchanges the returned code, and stores tokens on disk.
 */
import { exec } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createOAuthClient, saveTokens, SCOPES, TOKEN_PATH } from "./auth.js";

async function main(): Promise<void> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${port}`;

  const client = createOAuthClient(redirectUri);
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force a refresh token even if previously consented
    scope: SCOPES,
  });

  const code = new Promise<string>((resolve, reject) => {
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      const error = url.searchParams.get("error");
      const authCode = url.searchParams.get("code");
      if (error) {
        res.end("Authorization failed. You can close this tab.");
        reject(new Error(`Authorization denied: ${error}`));
      } else if (authCode) {
        res.end("Authorized! You can close this tab and return to the terminal.");
        resolve(authCode);
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
  });

  console.log("Opening browser for Google consent…");
  console.log(`If it doesn't open, visit:\n\n  ${authUrl}\n`);
  exec(`open ${JSON.stringify(authUrl)}`, () => {});

  const { tokens } = await client.getToken(await code);
  server.close();

  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Remove this app's access at " +
        "https://myaccount.google.com/permissions and run `npm run auth` again."
    );
  }

  await saveTokens(tokens);
  console.log(`Tokens saved to ${TOKEN_PATH} (mode 600).`);
  console.log("Done — the MCP server can now authenticate silently.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

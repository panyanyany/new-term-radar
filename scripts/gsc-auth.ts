import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
// 本地桌面 OAuth，使用随机 state 与 PKCE，令牌格式兼容现有配置。
async function main(): Promise<void> {
  const raw = JSON.parse(
      readFileSync(process.argv[2] ?? "gsc_client.json", "utf8"),
    ),
    c = raw.installed;
  if (!c) throw new Error("Google client must be a Desktop app");
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string")
    throw new Error("local OAuth listener unavailable");
  const redirect = `http://127.0.0.1:${addr.port}/`,
    client = new OAuth2Client(c.client_id, c.client_secret, redirect),
    state = randomBytes(24).toString("hex"),
    pkce = await client.generateCodeVerifierAsync();
  const timer = setTimeout(() => server.close(), 300000);
  try {
    const code = await new Promise<string>((resolve, reject) => {
      server.on("close", () => reject(new Error("OAuth callback timed out")));
      server.on("request", (req, res) => {
        const u = new URL(req.url ?? "/", redirect);
        if (u.searchParams.get("state") !== state) {
          res.writeHead(400);
          res.end("Invalid state");
          return;
        }
        const code = u.searchParams.get("code");
        if (!code) {
          res.end("Authorization failed");
          reject(new Error("Google authorization failed"));
          return;
        }
        res.end("Authorization received. You can close this page.");
        resolve(code);
      });
      console.log(
        "在浏览器中打开以下授权地址：\n" +
          client.generateAuthUrl({
            access_type: "offline",
            prompt: "consent",
            scope: ["https://www.googleapis.com/auth/webmasters.readonly"],
            state,
            code_challenge: pkce.codeChallenge,
            code_challenge_method: CodeChallengeMethod.S256,
          }),
      );
    });
    const { tokens } = await client.getToken({
      code,
      codeVerifier: pkce.codeVerifier,
    });
    if (!tokens.refresh_token)
      throw new Error("Google returned no refresh_token");
    writeFileSync(
      "gsc_token.json",
      JSON.stringify(
        {
          type: "authorized_user",
          client_id: c.client_id,
          client_secret: c.client_secret,
          refresh_token: tokens.refresh_token,
          token_uri: "https://oauth2.googleapis.com/token",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log("wrote gsc_token.json");
  } finally {
    clearTimeout(timer);
    server.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

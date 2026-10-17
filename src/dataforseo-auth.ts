import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SourceConfigError, SourceTransportError } from "./source-errors.js";
import { type Data } from "./core.js";

let refreshing: Promise<string> | undefined;
// 显式 API 凭据优先；本机也可复用 Codex 已授权的 DataForSEO OAuth。
export async function authorization(): Promise<string> {
  const envLogin = process.env.DATAFORSEO_LOGIN;
  const envPassword = process.env.DATAFORSEO_PASSWORD;
  if (envLogin || envPassword) return basic(envLogin, envPassword);
  const file = join(homedir(), ".dataforseo/credentials.json");
  if (existsSync(file)) {
    const local: Data = JSON.parse(readFileSync(file, "utf8"));
    return basic(local.login, local.password);
  }
  // 不读取其他服务的凭据，也不把令牌放入项目状态、账本或日志。
  const path = join(
    process.env.CODEX_HOME ?? join(homedir(), ".codex"),
    ".credentials.json",
  );
  if (!existsSync(path))
    throw new SourceConfigError(
      "DataForSEO: configure API credentials or run codex mcp login dataforseo",
    );
  const all: Data = JSON.parse(readFileSync(path, "utf8"));
  const entry = Object.entries(all).find(
    ([, value]) =>
      value.server_name === "dataforseo" &&
      value.server_url === "https://mcp.dataforseo.com/mcp",
  );
  if (!entry?.[1].access_token)
    throw new SourceConfigError("DataForSEO OAuth credentials not found");
  const [id, token] = entry;
  if (typeof token.expires_at !== "number")
    throw new SourceConfigError(
      "DataForSEO OAuth expiry missing; log in again",
    );
  if (token.expires_at > Date.now() + 60000)
    return `Bearer ${token.access_token}`;
  if (!token.refresh_token)
    throw new SourceConfigError(
      "DataForSEO OAuth expired; run codex mcp login dataforseo",
    );
  // 同一进程共享刷新，原子回写前重新读取文件，保留其他 MCP 的授权。
  refreshing ??= refresh(path, id, token).finally(() => {
    refreshing = undefined;
  });
  return `Bearer ${await refreshing}`;
}

// 只向服务商固定的 OAuth 地址发送刷新令牌，不跟随重定向。
async function refresh(path: string, id: string, token: Data): Promise<string> {
  const response = await fetch("https://data.dataforseo.com/oauth/token", {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
      client_id: token.client_id,
    }),
    signal: AbortSignal.timeout(30000),
  }).catch((cause: unknown) => {
    throw new SourceTransportError(
      "DataForSEO OAuth refresh transport failed",
      { cause },
    );
  });
  if (!response.ok)
    throw new SourceConfigError(
      `DataForSEO OAuth refresh HTTP ${response.status}; log in again`,
    );
  const body = (await response.json()) as Data;
  if (
    typeof body.access_token !== "string" ||
    !Number.isFinite(body.expires_in) ||
    body.expires_in <= 0
  )
    throw new SourceConfigError(
      "DataForSEO OAuth refresh invalid response; log in again",
    );
  const all: Data = JSON.parse(readFileSync(path, "utf8"));
  // 错误示范：用旧文件覆盖整份凭据，会丢失刷新期间其他 MCP 的登录信息。
  if (all[id]?.refresh_token !== token.refresh_token)
    throw new SourceConfigError(
      "DataForSEO OAuth changed during refresh; retry after checking login",
    );
  all[id] = {
    ...all[id],
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? token.refresh_token,
    expires_at: Date.now() + body.expires_in * 1000,
  };
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(all), { mode: 0o600 });
  renameSync(temp, path);
  return body.access_token;
}

// 凭据必须成对出现，不能用另一来源的密码拼接残缺配置。
function basic(login: unknown, password: unknown): string {
  if (
    typeof login !== "string" ||
    !login.trim() ||
    typeof password !== "string" ||
    !password.trim()
  )
    throw new SourceConfigError(
      "DataForSEO requires both API login and password",
    );
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

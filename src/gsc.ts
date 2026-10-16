import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { jsonFetch, shift, today, type Data, type Config } from "./core.js";
export function freshQueries(recent: Data[], before: Data[]): Data[] {
  const seen = new Set(before.map((r) => r.query)),
    fresh: Record<string, Data> = {};
  for (const r of recent) {
    if (seen.has(r.query)) continue;
    const f = (fresh[r.query] ??= {
      query: r.query,
      impressions: 0,
      clicks: 0,
      page: r.page,
    });
    f.impressions += r.impressions;
    f.clicks += r.clicks;
  }
  return Object.values(fresh).sort((a, b) => b.impressions - a.impressions);
}
// 沿用 Google authorized_user 凭据格式，可直接使用已有刷新令牌。
async function token(cfg: Config): Promise<string> {
  const c = cfg.gsc as Data,
    path = resolve(cfg._dir, c.token_file ?? "gsc_token.json"),
    raw = existsSync(path)
      ? readFileSync(path, "utf8")
      : process.env.GSC_TOKEN_JSON;
  if (!raw)
    throw new Error(
      "no Search Console token: gsc_token.json or GSC_TOKEN_JSON",
    );
  const tok = JSON.parse(raw),
    body = new URLSearchParams({
      client_id: tok.client_id,
      client_secret: tok.client_secret,
      refresh_token: tok.refresh_token,
      grant_type: "refresh_token",
    });
  const r = await jsonFetch(
    tok.token_uri ?? "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
    30000,
  );
  if (!r.access_token) throw new Error("GSC refresh returned no access token");
  return r.access_token;
}
async function query(
  access: string,
  site: string,
  start: string,
  end: string,
  dimensions: string[],
  fresh: boolean,
): Promise<Data[]> {
  const b = await jsonFetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: start,
        endDate: end,
        dimensions,
        rowLimit: 25000,
        ...(fresh ? { dataState: "all" } : {}),
      }),
    },
    60000,
  );
  return (b.rows ?? [])
    .filter(
      (r: Data) =>
        !/"|\b(site|inurl|intitle|intext|filetype):|(^|\s)-\w|\*|\bOR\b/.test(
          r.keys[0],
        ),
    )
    .map((r: Data) => ({
      ...Object.fromEntries(dimensions.map((d, i) => [d, r.keys[i]])),
      impressions: Math.trunc(r.impressions),
      clicks: Math.trunc(r.clicks),
    }));
}
export async function gscNew(cfg: Config): Promise<Data> {
  const site = (cfg.gsc as Data).site;
  if (!site) return { off: true };
  const access = await token(cfg),
    end = shift(today(), -1),
    start = shift(end, -2),
    recent = await query(access, site, start, end, ["query", "page"], true),
    before = await query(
      access,
      site,
      shift(start, -60),
      shift(start, -1),
      ["query"],
      false,
    ),
    fresh = freshQueries(recent, before);
  return {
    window: `${start}..${end}`,
    total_new: fresh.length,
    min_impressions: 5,
    queries: fresh.filter((r) => r.impressions >= 5).slice(0, 30),
  };
}

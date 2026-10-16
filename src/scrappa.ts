import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { utcToday, shift, days, round, type Point, type Data } from "./core.js";
export class ScrappaError extends Error {
  override name = "ScrappaError";
}
// 复用本机已配置密钥，不将令牌写入项目文件或错误日志。
export function key(): string {
  if (process.env.SCRAPPA_API_KEY?.trim())
    return process.env.SCRAPPA_API_KEY.trim();
  const p = join(homedir(), ".scrappa/key");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  try {
    const h =
      JSON.parse(
        readFileSync(join(homedir(), ".config/opencode/opencode.json"), "utf8"),
      ).mcp?.scrappa?.headers ?? {};
    return String(
      Object.entries(h).find(([k]) => k.toLowerCase() === "x-api-key")?.[1] ??
        "",
    ).trim();
  } catch {
    return "";
  }
}
export function decode(result: Data): Data {
  if (result.isError)
    throw new ScrappaError("Scrappa endpoint failed (no automatic retry)");
  let body = result.structuredContent;
  if (body == null) {
    try {
      body = JSON.parse(
        result.content.find((c: Data) => c.type === "text").text,
      );
    } catch {
      throw new ScrappaError("Scrappa returned non-JSON content");
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || body.error)
    throw new ScrappaError("Scrappa returned an invalid/error response");
  return body;
}
export async function callMany(
  requests: [string, Data][],
): Promise<[Data[], number]> {
  if (!requests.length) return [[], 0];
  const token = key();
  if (!token)
    throw new ScrappaError("set SCRAPPA_API_KEY or configure ~/.scrappa/key");
  const client = new Client({ name: "new-term-radar", version: "0.2.1" });
  const transport = new StreamableHTTPClientTransport(
    new URL(process.env.SCRAPPA_MCP_URL ?? "https://scrappa.co/mcp"),
    { requestInit: { headers: { "X-API-KEY": token } } },
  );
  try {
    await client.connect(transport, { timeout: 120000 });
    const out: Data[] = [];
    for (const [endpoint, params] of requests)
      out.push(
        decode(
          await client.callTool(
            {
              name: "call-endpoint",
              arguments: { endpoint, params: JSON.stringify(params) },
            },
            undefined,
            { timeout: 120000 },
          ),
        ),
      );
    return [out, out.length * 303];
  } catch (e) {
    if (e instanceof ScrappaError) throw e;
    throw new ScrappaError(
      `Scrappa MCP transport failed: ${e instanceof Error ? e.name : "Error"}`,
    );
  } finally {
    await client.close().catch(() => {});
  }
}
export function posted(tw: Data): Date {
  const date = new Date(tw.created_at);
  if (typeof tw.created_at !== "string" || !Number.isFinite(+date))
    throw new ScrappaError("tweet missing valid created_at");
  return date;
}
// 只有完整覆盖 30 小时后才返回，分页停滞或预算不足均保留原词表。
export async function userPosts(
  handle: string,
  now = new Date(),
  maxPages = 3,
): Promise<[Data[], number]> {
  const cutoff = +now - 30 * 3600000,
    seen = new Set(),
    cursors = new Set();
  const posts: Data[] = [];
  let cost = 0,
    params: Data = { handle, count: 20, with_replies: true };
  for (let i = 0; i < maxPages; i++) {
    const [batch, c] = await callMany([["x-twitter-user-tweets", params]]);
    cost += c;
    const rows = batch[0].results;
    if (!Array.isArray(rows))
      throw new ScrappaError("user tweets missing results array");
    for (const tw of rows) {
      const created = posted(tw);
      if (
        !tw.id ||
        typeof tw.text !== "string" ||
        tw.likes == null ||
        !Number.isFinite(Number(tw.likes))
      )
        throw new ScrappaError("tweet missing id/text/likes");
      if (!seen.has(tw.id)) {
        seen.add(tw.id);
        posts.push({
          account: handle,
          text: (tw.reposted_by ? "RT @" : "") + tw.text,
          likes: Number(tw.likes),
          url: tw.url ?? "",
          created,
        });
      }
    }
    const cursor = batch[0].cursor;
    if (!cursor || (rows.length && +posted(rows.at(-1)) < cutoff))
      return [posts, cost];
    if (!rows.length || cursors.has(cursor))
      throw new ScrappaError("tweet pagination stalled");
    cursors.add(cursor);
    params = { ...params, cursor };
  }
  throw new ScrappaError(
    `@${handle}: 30-hour coverage exceeds ${maxPages} pages; vocabulary unchanged`,
  );
}
export function timeline(
  body: Data,
  keywords: string[],
  start: string,
  end: string,
): Point[] {
  if (!Array.isArray(body.timeline_data))
    throw new ScrappaError("Trends missing timeline_data array");
  const out: Point[] = [];
  for (const p of body.timeline_data) {
    if (p.isPartial || p.is_partial) continue;
    try {
      if (p.timestamp == null) throw new Error();
      const day = new Date(Number(p.timestamp) * 1000)
        .toISOString()
        .slice(0, 10);
      let values: unknown[];
      if (keywords.length === 1 && !p.values?.length) values = [p.value];
      else {
        if (
          !Array.isArray(p.values) ||
          p.values.length !== keywords.length ||
          p.values.some(
            (r: Data, i: number) =>
              r.query !== keywords[i] || r.has_data === false,
          )
        )
          throw new Error();
        values = p.values.map((r: Data) => r.value);
      }
      if (
        values.some(
          (v) =>
            v == null ||
            !Number.isFinite(Number(v)) ||
            Number(v) < 0 ||
            Number(v) > 100,
        )
      )
        throw new Error();
      out.push([day, ...values.map((v) => Math.trunc(Number(v)))] as Point);
    } catch {
      throw new ScrappaError("invalid Trends point/comparison");
    }
  }
  out.sort((a, b) => a[0].localeCompare(b[0]));
  if (out.some((p, i) => i && days(p[0], out[i - 1][0]) !== 1))
    throw new ScrappaError("Trends is not a continuous daily series");
  if (out.length && out[0][0] > start)
    throw new ScrappaError("Trends does not cover the requested baseline");
  return out.filter((p) => p[0] >= start && p[0] <= end);
}
export interface TrendRequest {
  call_id: string;
  keywords: string[];
  start: string;
  end: string;
}
export async function trendsMany(
  requests: TrendRequest[],
  now = utcToday(),
): Promise<[Record<string, Point[]>, number]> {
  for (const r of requests) {
    if (!(shift(now, -90) <= r.start && r.start <= r.end && r.end <= now))
      throw new ScrappaError(
        "Scrappa daily Trends supports only windows within the last 90 days",
      );
    if (
      !r.keywords.length ||
      r.keywords.length > 5 ||
      r.keywords.some((k) => k.includes(","))
    )
      throw new ScrappaError("Trends requires 1-5 keywords without commas");
  }
  const [data, cost] = await callMany(
    requests.map((r) => [
      "google-trends-interest",
      { q: r.keywords.join(","), geo: "Worldwide", time_range: "90d" },
    ]),
  );
  const out: Record<string, Point[]> = {};
  requests.forEach((r, i) => {
    let points = timeline(data[i], r.keywords, r.start, r.end);
    const peak = Math.max(0, ...points.map((p) => p[1]));
    if (r.keywords.length === 1 && peak)
      points = points.map(([d, v]) => [d, round((v * 100) / peak)]);
    out[r.call_id] = points;
  });
  return [out, cost];
}

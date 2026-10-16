import { callAll } from "./aisa.js";
import {
  STOP,
  loadSnap,
  saveSnap,
  today,
  shift,
  t,
  type Data,
  type Config,
} from "./core.js";
const DOMAIN_STOP = new Set(
  "com net org app io co online free tool tools the my get official site hub pro best video videos".split(
    " ",
  ),
);
export function nameTerms(domain: string): string[] {
  return domain
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .split(/[-_.]+/)
    .filter(
      (w) =>
        w.length >= 4 &&
        !STOP.has(w) &&
        !DOMAIN_STOP.has(w) &&
        !/^\d+$/.test(w),
    );
}
export function keep(item: Data, minEtv = 1000, minKeywords = 20): boolean {
  const o = item.metrics?.organic ?? {};
  return (o.etv ?? 0) > minEtv && (o.count ?? 0) >= minKeywords;
}
export function siteRow(item: Data, query: string): Data {
  const o = item.metrics?.organic ?? {};
  return {
    domain: item.domain,
    query,
    created: String(item.created_datetime ?? "None").slice(0, 10),
    first_seen: String(item.first_seen ?? "None").slice(0, 10),
    etv: Math.trunc(o.etv ?? 0),
    keywords: Math.trunc(o.count ?? 0),
  };
}
// WHOIS 仍使用 AIsa，错误交由运行器显示，不把不完整响应当作新站名单。
export async function newSites(
  cfg: Config,
  state: string,
  day = today(),
): Promise<Data> {
  const c = cfg.new_sites,
    since = shift(day, -c.window_days) + " 00:00:00 +00:00",
    calls = Object.entries(c.queries).map(([call_id, pattern]) => ({
      call_id,
      tool: "post_dataforseo_domains_whois_overview_live",
      arguments: {
        body: [
          {
            limit: 30,
            order_by: ["metrics.organic.etv,desc"],
            filters: [
              ["created_datetime", ">", since],
              "and",
              ["first_seen", ">", since],
              "and",
              ["metrics.organic.etv", ">", c.min_etv],
              "and",
              ["domain", "like", pattern],
            ],
          },
        ],
      },
    })),
    [data, cost] = await callAll(calls),
    sites: Record<string, Data> = {};
  for (const name of Object.keys(c.queries))
    for (const item of data[name]?.tasks?.[0]?.result?.[0]?.items ?? [])
      if (keep(item, c.min_etv, c.min_keywords) && !sites[item.domain])
        sites[item.domain] = siteRow(item, name);
  const seen = loadSnap<Record<string, string>>(state, "new_sites") ?? {},
    rows = Object.values(sites).sort((a, b) => b.etv - a.etv);
  for (const r of rows) {
    r.new = !(r.domain in seen);
    seen[r.domain] ??= day;
  }
  if (Object.keys(data).length) saveSnap(state, "new_sites", seen);
  return {
    queries: calls.length,
    answered: Object.keys(data).length,
    cost_micros: cost,
    sites: rows,
    terms: rows
      .filter((r) => r.new)
      .flatMap((r) =>
        nameTerms(r.domain).map((term) => ({
          term,
          recent: 1,
          examples: [`${r.domain} · ${r.keywords} keywords`],
          note: t("note_site", r),
        })),
      ),
  };
}

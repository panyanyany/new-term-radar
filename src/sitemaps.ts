import { pageDiff } from "./pages.js";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { gunzipSync } from "node:zlib";
import { setTimeout as sleep } from "node:timers/promises";
import {
  UA,
  loadSnap,
  saveSnap,
  errorText,
  type Data,
  type Config,
} from "./core.js";
import { bySource, surges } from "./terms.js";
// 免费公开 sitemap 允许重试，响应中的 gzip 与 XML 实体交给成熟解析器。
export async function fetchXml(url: string): Promise<string> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url.replaceAll("&amp;", "&"), {
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(40000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      return (
        body[0] === 31 && body[1] === 139 ? gunzipSync(body) : body
      ).toString();
    } catch (e) {
      if (i === 2) throw e;
      await sleep(10000 * (i + 1));
    }
  }
  return "";
}
export function locations(xml: string): string[] {
  if (XMLValidator.validate(xml) !== true)
    throw new Error("invalid sitemap XML");
  const root = new XMLParser({
      ignoreAttributes: true,
      processEntities: true,
      trimValues: true,
    }).parse(xml),
    out: string[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (k === "loc" && typeof x === "string") out.push(x);
        else visit(x);
      }
  };
  visit(root);
  return out;
}
export async function siteUrls(
  index: string,
  shards: string | undefined,
  pause: number,
  strip = false,
): Promise<Set<string>> {
  const files = shards
      ? locations(await fetchXml(index)).filter((u) =>
          new RegExp(shards).test(u),
        )
      : [index],
    urls = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    if (i || shards) await sleep(pause * 1000);
    for (let u of locations(await fetchXml(files[i]))) {
      if (strip)
        u = u.replace(
          /^(https?:\/\/[^/]+)\/[a-z]{2}(?:-[A-Za-z]{2,4})?(?=\/)/,
          "$1",
        );
      urls.add(u);
    }
  }
  return urls;
}
export function slugText(url: string): string {
  return url
    .replace(/^https?:\/\/[^/]+/, "")
    .split("?")[0]
    .replace(/\b[0-9a-f]{8,}\b|\.(html|xml)$/g, " ")
    .replace(/[/_\-]+/g, " ");
}
export async function diff(cfg: Config, state: string): Promise<Data> {
  const pages = await pageDiff(cfg, state);
  if (!Object.keys(cfg.sitemaps).length) return { sites: {}, terms: [], pages };
  const report: Data = {},
    recent: [string, string][] = [],
    baseline: [string, string][] = [];
  let i = 0;
  for (const [site, s] of Object.entries(cfg.sitemaps) as [string, Data][]) {
    const name = "sitemaps/" + site.replace(/[^A-Za-z0-9._-]/g, "_"),
      old = loadSnap<string[]>(state, name),
      pause = s.pause ?? 3;
    try {
      if (i++) await sleep(pause * 1000);
      const now = await siteUrls(s.index, s.shards, pause, !!s.strip_locale),
        // Set 查重避免大站点逐项扫描旧数组。
        previous = new Set(old ?? []),
        added =
          old === null ? [] : [...now].filter((u) => !previous.has(u)).sort();
      report[site] = {
        urls: now.size,
        new: added.length,
        first_run: old === null,
        sample: added.slice(0, 8),
      };
      // 逐条追加，不把整站 URL 展开为函数参数，避免超过引擎参数数量上限。
      for (const u of added) recent.push([u, slugText(u)]);
      for (const u of old ?? []) baseline.push([u, slugText(u)]);
      if (now.size) saveSnap(state, name, [...now].sort());
    } catch (e) {
      report[site] = { error: errorText(e).slice(0, 120) };
    }
  }
  return {
    pages,
    sites: report,
    terms: surges(
      bySource(recent),
      bySource(baseline),
      recent.length / Math.max(baseline.length, 1),
      3,
      25,
    ),
  };
}

import { savePageBatch } from "./page-batches.js";
import { Store } from "./store.js";
import { extractPageKeywords } from "./page-keywords.js";
import { load } from "cheerio";
import {
  compact,
  errorText,
  loadSnap,
  saveSnap,
  UA,
  type Config,
  type Data,
} from "./core.js";

export interface PageSource {
  url: string;
  include?: string;
  exclude?: string;
}
export interface PageCandidate {
  url: string;
  keyword: string;
  basis: "anchor" | "url" | "unknown";
  anchors: string[];
  explanation?: string;
}
const generic =
  /^(?:learn more|read more|try(?: it| this)?(?: now| for free| free)?|get started|start(?: now| for free)?|click here|view(?: more| all)?|explore(?: more)?|download(?: now)?|open|create|start creating|100% free to create|更多|了解更多|立即体验|免费试用)$/i;

// 统一链接身份，保留业务查询参数，仅移除跟踪参数和片段。
function normalize(href: string, base: string): URL | null {
  try {
    const u = new URL(href, base),
      origin = new URL(base);
    if (
      !/^https?:$/.test(u.protocol) ||
      u.hostname.replace(/^www\./, "") !== origin.hostname.replace(/^www\./, "")
    )
      return null;
    u.protocol = origin.protocol;
    u.host = origin.host;
    u.hash = "";
    for (const key of [...u.searchParams.keys()])
      if (/^(utm_.+|gclid|fbclid|msclkid)$/i.test(key))
        u.searchParams.delete(key);
    u.searchParams.sort();
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u;
  } catch {
    return null;
  }
}

// 所有锚文本均不可用时，只从最后一个有效 slug 推断，随机 ID 不作为词。
function fromUrl(url: string): string {
  try {
    const slug = decodeURIComponent(
      new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "",
    )
      .replace(/\.(html?|php|aspx?)$/i, "")
      .replace(/^\d{4}-\d{2}-\d{2}-/, "");
    if (/^(?:[\da-f]{8,}|\d+|index)$/i.test(slug)) return "";
    return compact(slug.replace(/[-_]+/g, " "));
  } catch {
    return "";
  }
}

// 先按 URL 汇总全部链接，再选描述性锚文本，避免第一个空图片链接覆盖后面的标题。
export function pageLinks(html: string, source: PageSource): PageCandidate[] {
  const $ = load(html),
    groups = new Map<string, string[]>(),
    include = source.include ? new RegExp(source.include) : null;
  $("a[href]").each((_, el) => {
    const u = normalize($(el).attr("href")!, source.url);
    if (
      !u ||
      u.href === normalize(source.url, source.url)?.href ||
      !u.pathname.replace(/\//g, "") ||
      /\.(?:png|jpe?g|gif|svg|webp|ico|pdf|zip|mp4|css|js|xml)$/i.test(
        u.pathname,
      ) ||
      /\/(?:login|signup|sign-in|privacy|terms|contact|about|pricing|category|tag|page)(?:[/.\-]|$)/i.test(
        u.pathname,
      ) ||
      (source.exclude && new RegExp(source.exclude).test(u.pathname)) ||
      (include && !include.test(u.pathname))
    )
      return;
    const anchors = groups.get(u.href) ?? [];
    const text = compact(
      $(el).clone().find("script,style,svg").remove().end().text(),
    );
    if (text && !anchors.includes(text)) anchors.push(text);
    groups.set(u.href, anchors);
  });
  return [...groups].map(([url, anchors]) => {
    const usable = anchors.filter(
      (t) =>
        t.length >= 3 &&
        t.length <= 160 &&
        !generic.test(t) &&
        /[\p{L}]/u.test(t),
    );
    // 较短的有效标题通常比带整段说明的卡片更适合作为候选词；相同长度保持页面顺序。
    usable.sort((a, b) => a.length - b.length);
    const keyword = usable[0] ?? fromUrl(url);
    return {
      url,
      keyword,
      basis: usable.length ? "anchor" : keyword ? "url" : "unknown",
      anchors,
    };
  });
}

// 快照保留所有曾出现的 URL；抓取失败或空页面时不覆盖，重新出现不会重复报新。
export async function pageDiff(cfg: Config, state: string): Promise<Data> {
  let research_batch: string | undefined;
  const createdAt = new Date().toISOString();
  const sites: Data = {},
    candidates: Data[] = [];
  for (const [site, source] of Object.entries(cfg.pages ?? {})) {
    const name = `pages/${site.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    try {
      const response = await fetch(source.url, {
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(40000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.headers.get("content-type")?.includes("text/html"))
        throw new Error("expected HTML page");
      const current = pageLinks(await response.text(), source);
      if (!current.length)
        throw new Error("no eligible links; snapshot preserved");
      const old = loadSnap<Record<string, PageCandidate>>(state, name),
        seen = { ...old };
      const added = old === null ? [] : current.filter((row) => !old[row.url]);
      // 仅对新增链接批量提词；失败不推进本站快照，下一次仍可重试。
      if (added.length) {
        const store = new Store(state);
        try {
          const extracted = await extractPageKeywords(
            store,
            added.map((row) => ({ title: row.keyword, url: row.url })),
            cfg.usecases.model,
          );
          added.forEach((row, i) => Object.assign(row, extracted[i]));
        } finally {
          store.close();
        }
      }
      for (const row of current) seen[row.url] = row;
      if (added.length) {
        // 错误示范：只推进 seen 再付费研究，失败后新增链接就无法从下一轮抓取恢复。
        research_batch = savePageBatch(
          state,
          {
            sites,
            candidates: [
              ...candidates,
              ...added.map((row) => ({ site, ...row })),
            ],
          },
          research_batch,
          createdAt,
        );
      }
      saveSnap(state, name, seen);
      sites[site] = {
        urls: current.length,
        seen: Object.keys(seen).length,
        new: added.length,
        first_run: old === null,
      };
      candidates.push(...added.map((row) => ({ site, ...row })));
    } catch (e) {
      sites[site] = { error: errorText(e) };
    }
  }
  return { sites, candidates, research_batch, created_at: createdAt };
}

import { fetchSeries } from "./trends-series.js";
export { fetchSeries } from "./trends-series.js";
import { measure } from "./trend-measure.js";
export {
  WORLD,
  COUNTRY,
  shape,
  ownPerDay,
  benchDaily,
  size,
  decide,
  measure,
} from "./trend-measure.js";
import { withModelCosts } from "./model-costs.js";
import * as aisa from "./aisa.js";
import { search } from "./x.js";
import * as goany from "./goanyapi.js";
import { googleSearch } from "./scrappa.js";
import { get } from "./breakout.js";
import {
  shift,
  today,
  round,
  unique,
  compact,
  errorText,
  loadSnap,
  saveSnap,
  type Data,
  type Config,
  type Point,
} from "./core.js";
import prompts from "./prompts.json" with { type: "json" };
export function due(
  names: string[],
  seen: Record<string, Data>,
  day: string,
  limit: number,
  recheck: number,
): string[] {
  return unique([
    ...names.filter((n) => !(n in seen)),
    ...Object.keys(seen)
      .filter(
        (n) =>
          names.includes(n) &&
          seen[n].runs === 1 &&
          seen[n].first <= shift(day, -recheck),
      )
      .sort((a, b) => seen[a].first.localeCompare(seen[b].first)),
  ]).slice(0, limit);
}
async function readme(repo: string): Promise<string> {
  try {
    return Buffer.from((await get(`/repos/${repo}/readme`)).content, "base64")
      .toString()
      .slice(0, 3000);
  } catch {
    return "";
  }
}
// 按名称独立检索；Google 摘要为默认，X 高赞证据仅显式选择。
export async function evidence(
  names: string[],
  repos: Record<string, string>,
  day: string,
): Promise<[Record<string, Data>, number]> {
  const provider = process.env.KEYWORD_EVIDENCE_PROVIDER?.trim() || "google";
  if (!["google", "x"].includes(provider))
    throw new Error("unsupported keyword evidence provider");
  const out: Record<string, Data> = {};
  let cost = 0;
  for (const n of names) {
    let error = "",
      tweets: Data[] = [],
      pages: Data[] = [];
    try {
      const [rows, c] =
        provider === "google" ? await googleSearch(n) : await search(n, day);
      cost += c;
      if (provider === "google") pages = rows;
      else tweets = rows;
    } catch (e) {
      error = compact(errorText(e).replace(/<[^>]+>/g, " ")).slice(0, 80);
    }
    const posts = tweets
      .map((t) => ({
        text: compact(t.text),
        likes: Number(t.likeCount ?? 0),
        by: t.author?.userName ?? "?",
        url: t.url ?? "",
      }))
      .sort((a, b) => b.likes - a.likes)
      .slice(0, 12);
    out[n] = {
      posts,
      pages,
      provider,
      readme: repos[n] ? await readme(repos[n]) : "",
      repo: repos[n] ?? "",
      error,
    };
  }
  return [out, cost];
}
export function parse(answer: string, name: string): Data[] {
  let items;
  try {
    items = JSON.parse(answer.match(/\{.*\}/s)?.[0] ?? "{}").use_cases;
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];
  const out: Data[] = [],
    seen = new Set();
  for (const it of items) {
    const phrase = compact(it?.phrase).toLowerCase(),
      n = phrase.split(" ").filter(Boolean).length;
    if (n < 2 || n > 5 || phrase.includes(name) || seen.has(phrase)) continue;
    seen.add(phrase);
    out.push({
      phrase,
      evidence: compact(it.evidence).slice(0, 160),
      brand: !!it.brand,
    });
  }
  return out.slice(0, 6);
}
const postText = (posts: Data[]) =>
  posts
    .map((p) => `- (${p.likes} likes) @${p.by}: ${p.text.slice(0, 400)}`)
    .join("\n");
// 搜索摘要是外部资料，不具有指令权限；给模型保留标题与可追溯链接。
const evidenceText = (ev: Data) =>
  [
    ...(ev.pages ?? []).map(
      (p: Data) => `- ${p.title}: ${p.text} (source: ${p.url})`,
    ),
    postText(ev.posts ?? []),
  ]
    .filter(Boolean)
    .join("\n");
export async function propose(
  model: string,
  name: string,
  ev: Data,
): Promise<Data[]> {
  if (!ev.posts.length && !ev.pages?.length && !ev.readme) return [];
  return parse(
    await aisa.chat(
      model,
      prompts.propose,
      `NAME: ${name}\n\nEVIDENCE:\n${evidenceText(ev) || "(none found)"}\n` +
        (ev.readme ? `\nREADME of ${ev.repo}:\n${ev.readme}\n` : ""),
      900,
    ),
    name,
  );
}
export const squash = (s: string) => s.toLowerCase().replace(/[\s\-_.]+/g, "");
export function splitRelated(name: string, related: Data): [string[], Data[]] {
  const tails: string[] = [],
    cands: Data[] = [],
    seen = new Set();
  for (const kind of ["rising", "top"])
    for (const q of related[kind] ?? []) {
      if (seen.has(q) || q === name) continue;
      seen.add(q);
      if (
        name.split(" ").every((w) => q.split(" ").includes(w)) ||
        squash(q).includes(squash(name))
      )
        tails.push(q);
      else if (q.split(" ").length >= 2)
        cands.push({
          phrase: q,
          brand: false,
          source: "searched",
          rising: kind === "rising",
          evidence: `searched on Google together with ${name} (${kind})`,
        });
    }
  return [tails, cands.slice(0, 12)];
}
export async function screen(
  model: string,
  name: string,
  ev: Data,
  cands: Data[],
): Promise<Data[]> {
  if (!cands.length) return [];
  try {
    const answer = await aisa.chat(
        model,
        prompts.screen,
        `NAME: ${name}\n\nEVIDENCE:\n${[evidenceText(ev), ev.readme?.slice(0, 1200)].filter(Boolean).join("\n")}\n\nCANDIDATES:\n` +
          JSON.stringify(cands.map((c, i) => ({ i, keyword: c.phrase }))),
        600,
      ),
      items = JSON.parse(answer.match(/\[.*\]/s)?.[0] ?? "[]");
    if (!Array.isArray(items)) return cands;
    const views = new Map(
      items.filter((x) => x && x.i != null).map((x) => [Number(x.i), x]),
    );
    return cands.map((c, i) => {
      const v = views.get(i);
      return v && v.score != null && Number.isFinite(Number(v.score))
        ? {
            ...c,
            relevance: Number(v.score),
            brand: c.brand || !!v.brand,
            is_name: !!v.name,
            established: !!v.established,
          }
        : c;
    });
  } catch {
    return cands;
  }
}
export function otherNames(
  name: string,
  viewed: Data[],
  reading: string[] = [],
): Data[] {
  const family = new Set(
      name.split(" ").filter((w) => /^[a-z]+$/i.test(w) && w.length > 2),
    ),
    siblings = reading.filter((n) => n !== name).map(squash),
    seen = new Set(),
    out: Data[] = [];
  for (const u of viewed) {
    const words = unique<string>(u.phrase.split(" ")),
      key = [...words].sort().join(" ");
    if (
      u.is_name &&
      u.rising &&
      !u.established &&
      !seen.has(key) &&
      !words.some((w) => family.has(w)) &&
      !siblings.some((s) => squash(u.phrase).includes(s))
    ) {
      seen.add(key);
      out.push({ term: u.phrase, with: name });
    }
  }
  return out.slice(0, 5);
}
export const relevant = (cands: Data[]) =>
  cands.filter((c) => !c.is_name && (c.relevance ?? 1) >= 0.6);
export async function countrySeries(
  rows: Data[],
  c: Config["usecases"],
): Promise<[Record<string, Point[]>, number, string[]]> {
  const generic = rows
      .filter(
        (r) => r.kind === "generic" && (r.volume ?? 0) >= c.country_min_volume,
      )
      .sort((a, b) => b.volume - a.volume)
      .slice(0, c.country_max),
    picked = [...rows.filter((r) => r.kind === "name"), ...generic].map(
      (r) => r.phrase as string,
    ),
    results: [string, Point[], number, string][] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, picked.length) }, async () => {
      while (next < picked.length) {
        const i = next++,
          p = picked[i];
        try {
          const [s, cost] = await goany.dailySeries(p, c.related_geo);
          results[i] = [p, s, cost, ""];
        } catch (e) {
          results[i] = [p, [], 0, errorText(e)];
        }
      }
    }),
  );
  return [
    Object.fromEntries(results.filter((r) => !r[3]).map((r) => [r[0], r[1]])),
    results.reduce((s, r) => s + r[2], 0),
    results.filter((r) => r[3]).map((r) => `${r[0]}: ${r[3]}`),
  ];
}
// 手动 keywords 不改每日读取次数；完整分析成功后才更新状态。
async function research(
  cfg: Config,
  state: string,
  names: string[],
  repos: Record<string, string>,
  day = today(),
  onRequest = false,
): Promise<Data> {
  const c = cfg.usecases,
    seen: Record<string, Data> = onRequest
      ? {}
      : (loadSnap(state, "usecases") ?? {}),
    todo = onRequest
      ? unique(names).slice(0, 8)
      : due(names, seen, day, c.per_day, c.recheck_days);
  if (!todo.length) return { names: [], rows: [], proposed: 0, cost_micros: 0 };
  const [ev, cost] = await evidence(todo, repos, day),
    proposed: Record<string, Data> = {},
    tails: Record<string, string[]> = {},
    cosearch: Data[] = [],
    relatedErrors: string[] = [];
  let asked = 0,
    c0 = 0;
  const useRelated = !!goany.key() && c.related;
  for (const name of todo) {
    let cands: Data[] = (await propose(c.model, name, ev[name])).map((u) => ({
      ...u,
      source: "model",
    }));
    if (useRelated) {
      let related: Data = {};
      try {
        const [r, cost] = await goany.relatedQueries(name, c.related_geo);
        related = r;
        c0 += cost;
      } catch (e) {
        relatedErrors.push(`${name}: ${errorText(e)}`);
      }
      const [tail, searched] = splitRelated(name, related);
      tails[name] = tail;
      const have = new Set(cands.map((u) => u.phrase));
      cands.push(
        ...(searched.filter((u) => !have.has(u.phrase)) as typeof cands),
      );
    }
    asked += cands.length;
    const viewed = await screen(c.model, name, ev[name], cands);
    cosearch.push(...otherNames(name, viewed, todo));
    for (const u of relevant(viewed)) {
      const row = (proposed[u.phrase] ??= {
        ...u,
        term: u.phrase,
        kind: "generic",
        names: [],
      });
      row.names.push(name);
      row.brand ||= u.brand;
      if (u.source === "searched") row.source = "searched";
    }
  }
  const bench = c.benchmark.toLowerCase(),
    generic = Object.entries(proposed).map(([p, r]) => ({ ...r, phrase: p })),
    rows: Data[] = [
      ...todo.map((n) => ({
        term: n,
        phrase: n,
        kind: "name",
        names: [],
        brand: true,
        evidence: "",
      })),
      ...generic,
    ],
    [series, c3] = await fetchSeries(
      rows.map((r) => r.phrase),
      bench,
      day,
    ),
    measured = measure(rows, series, c.min_daily, day, {}, c.benchmark_daily),
    [local, c4, localErrors] =
      goany.key() && c.country_trends
        ? await countrySeries(rows, c)
        : ([{}, 0, []] as [Record<string, Point[]>, number, string[]]),
    daily = measure(
      rows,
      series,
      c.min_daily,
      day,
      local,
      measured ?? c.benchmark_daily,
    ),
    order: Record<string, number> = { prioritize: 0, watch: 1, skip: 2 };
  rows.sort(
    (a, b) =>
      order[a.decision] - order[b.decision] ||
      (b.per_day ?? 0) - (a.per_day ?? 0) ||
      (b.volume ?? 0) - (a.volume ?? 0),
  );
  // 先估算所有候选，再按量级筛选并限制通用词展示数量；无参考数据保留为空。
  const displayed = rows
    .filter(
      (r) =>
        r.kind === "generic" && (r.volume == null || r.volume >= c.min_volume),
    )
    .slice(0, c.trends_max);
  const visible = rows.filter(
    (r) => r.kind === "name" || displayed.includes(r),
  );
  if (!onRequest) {
    for (const n of todo) {
      const s = (seen[n] ??= { first: day, runs: 0 });
      s.runs++;
    }
    saveSnap(
      state,
      "usecases",
      Object.fromEntries(
        Object.entries(seen).filter(([, s]) => s.first >= shift(day, -30)),
      ),
    );
  }
  return {
    names: todo,
    rows: visible,
    volume_source: "trends_estimate",
    evidence_provider:
      process.env.KEYWORD_EVIDENCE_PROVIDER?.trim() || "google",
    evidence_sources: Object.fromEntries(
      Object.entries(ev).map(([name, e]) => [
        name,
        [...e.pages, ...e.posts]
          .map((p) => ({ title: p.title ?? p.by, url: p.url }))
          .concat(
            e.readme
              ? [
                  {
                    title: "README",
                    url: `https://github.com/${e.repo}#readme`,
                  },
                ]
              : [],
          ),
      ]),
    ),
    proposed: asked,
    relevant: Object.keys(proposed).length,
    kept: displayed.filter((r) => r.volume != null && r.volume >= c.min_volume)
      .length,
    benchmark: bench,
    bench_daily: daily ? round(daily) : null,
    volume_month: "",
    no_evidence: todo.filter(
      (n) => !ev[n].posts.length && !ev[n].pages.length && !ev[n].readme,
    ),
    posts_error: Object.entries(ev)
      .filter(([, e]) => e.error)
      .map(([n, e]) => `${n}: ${e.error}`)
      .join("; "),
    related: useRelated,
    tails: Object.fromEntries(
      Object.entries(tails).filter(([, v]) => v.length),
    ),
    cosearch,
    related_errors: relatedErrors,
    geo: c.related_geo,
    country_errors: localErrors,
    cost_micros: cost + c0 + c3 + c4,
  };
}
export function namesToRead(leads: Data[], recent: Data[]): string[] {
  return unique(
    [...leads, ...recent]
      .filter(
        (r) =>
          (r.kinds ?? []).some((k: string) =>
            ["x", "hf", "breakout", "newsite"].includes(k),
          ) &&
          (r.named == null || r.named >= 0.8),
      )
      .map((r) => r.term),
  );
}
export const degraded = (uc: Data): boolean =>
  !!(uc.posts_error || uc.related_errors?.length || uc.country_errors?.length);

// 统一收集提词与筛选的 token 费用，既有数据接口费用继续相加。
export async function run(...args: Parameters<typeof research>): Promise<Data> {
  return withModelCosts(() => research(...args));
}

import * as aisa from "./aisa.js";
import { search } from "./x.js";
import * as goany from "./goanyapi.js";
import { trendsMany, type TrendRequest } from "./scrappa.js";
import { settled } from "./review.js";
import { get } from "./breakout.js";
import {
  shift,
  today,
  days,
  mean,
  median,
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
export const WORLD = { unsettled: 2, window: 30, factor: 2, days: 2 },
  COUNTRY = { unsettled: 0, window: 10, factor: 1.5, days: 3 };
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
        (n) => seen[n].runs === 1 && seen[n].first <= shift(day, -recheck),
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
// 按名称独立检索，默认 Twitter AIO，AIsa 可显式切换作为备选。
export async function evidence(
  names: string[],
  repos: Record<string, string>,
  day: string,
): Promise<[Record<string, Data>, number]> {
  const out: Record<string, Data> = {};
  let cost = 0;
  for (const n of names) {
    let error = "",
      tweets: Data[] = [];
    try {
      const [rows, c] = await search(n, day);
      cost += c;
      tweets = rows;
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
export async function propose(
  model: string,
  name: string,
  ev: Data,
): Promise<Data[]> {
  if (!ev.posts.length && !ev.readme) return [];
  return parse(
    await aisa.chat(
      model,
      prompts.propose,
      `NAME: ${name}\n\nPOSTS:\n${postText(ev.posts) || "(none found)"}\n` +
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
        `NAME: ${name}\n\nEVIDENCE:\n${postText(ev.posts.slice(0, 6)) || ev.readme.slice(0, 1200)}\n\nCANDIDATES:\n` +
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
export async function volumes(
  phrases: string[],
  location_code: number,
): Promise<[Record<string, Data>, number]> {
  if (!phrases.length) return [{}, 0];
  const [data, cost] = await aisa.call([
      {
        call_id: "vol",
        tool: "post_dataforseo_keywords_gads_search_volume_live",
        arguments: {
          body: [{ keywords: phrases, location_code, language_code: "en" }],
        },
      },
    ]),
    out: Record<string, Data> = {};
  for (const r of data.vol?.tasks?.[0]?.result ?? []) {
    const m = r.monthly_searches?.[0];
    out[r.keyword] = {
      volume: Number(r.search_volume ?? 0),
      month: m ? `${m.year}-${String(m.month).padStart(2, "0")}` : "",
    };
  }
  return [out, cost];
}
// 先丢弃未稳定日期再归一化；连续上升区间从最新峰值向前回溯。
export function shape(input: Point[], day: string, rule = WORLD): Data {
  let points = input.filter((p) => p[0] < shift(day, -rule.unsettled));
  const top = Math.max(0, ...points.map((p) => p[1]));
  if (!top) return { no_data: true };
  points = points.map(([d, v]) => [d, round((v * 100) / top)]);
  const end = points.at(-1)![0],
    start = shift(end, -rule.window),
    base = mean(points.filter((p) => p[0] < start).map((p) => p[1])),
    window = points.filter((p) => p[0] >= start),
    [peak_day, peak] = [...window].sort(
      (a, b) => b[1] - a[1] || b[0].localeCompare(a[0]),
    )[0],
    line = Math.max(base * rule.factor, base + 10),
    above = window.filter((p) => p[1] >= line).map((p) => p[0]),
    rose = above.length >= rule.days,
    before = points.slice(-14, -7).map((p) => p[1]),
    week = points.slice(-7).map((p) => p[1]),
    out: Data = {
      no_data: false,
      base: round(base, 1),
      peak,
      peak_day,
      rose,
      new: rose && base < 10,
      momentum:
        before.length && mean(before) >= 5
          ? round(mean(week) / mean(before), 1)
          : null,
    };
  if (!rose) return { ...out, now: "flat" };
  let started = peak_day;
  while (above.includes(shift(started, -1))) started = shift(started, -1);
  out.started = started;
  const latest = Math.max(
    ...window.filter((p) => p[0] > shift(end, -3)).map((p) => p[1]),
  );
  out.now =
    days(end, peak_day) < 3
      ? "rising"
      : latest >= 0.5 * peak
        ? "holding"
        : "fading";
  return out;
}
export function ownPerDay(
  input: Point[],
  volume: number,
  month: string,
  day: string,
): number | null {
  const points = settled(input, day),
    anchor = mean(
      points.filter((p) => p[0].startsWith(month)).map((p) => p[1]),
    ),
    recent = mean(points.slice(-7).map((p) => p[1]));
  return anchor && volume ? round(((volume / 30) * recent) / anchor) : null;
}
export function benchDaily(rows: Data[]): number | null {
  const found: number[] = [];
  for (const r of rows) {
    if (!r.month || (r.volume ?? 0) < 1000) continue;
    const pair: Point[] = r._pair ?? [],
      term = mean(
        pair.filter((p) => p[0].startsWith(r.month)).map((p) => p[1]),
      ),
      bench = mean(
        pair.filter((p) => p[0].startsWith(r.month)).map((p) => p[2]),
      );
    if (term && bench) found.push(((r.volume / 30) * bench) / term);
  }
  return median(found);
}
export function size(input: Point[], day: string, daily: number | null): Data {
  const pair = settled(input, day),
    level = mean(pair.map((p) => p[2]));
  if (!level) return {};
  return {
    peak_vs: Math.max(...pair.slice(-30).map((p) => p[1])),
    bench_level: round(level, 1),
    ...(daily
      ? {
          per_day: round(
            (mean(pair.slice(-7).map((p) => p[1])) / level) * daily,
          ),
        }
      : {}),
  };
}
export function decide(
  s: Data,
  perDay: number | null | undefined,
  min: number,
): string {
  const big = (perDay ?? 0) >= min;
  if (s.no_data) return "watch";
  if (s.now === "fading") return "skip";
  if (s.now === "flat") return big ? "watch" : "skip";
  return big ? "prioritize" : "watch";
}
export async function fetchSeries(
  keywords: string[],
  benchmark: string,
  day: string,
): Promise<[Record<string, Data>, number]> {
  const calls: TrendRequest[] = keywords.flatMap((k, i) => [
      { call_id: `s${i}`, keywords: [k], start: shift(day, -90), end: day },
      {
        call_id: `p${i}`,
        keywords: [k, benchmark],
        start: shift(day, -90),
        end: day,
      },
    ]),
    [data, cost] = await trendsMany(calls);
  return [
    Object.fromEntries(
      keywords.map((k, i) => [
        k,
        { solo: data[`s${i}`] ?? [], pair: data[`p${i}`] ?? [] },
      ]),
    ),
    cost,
  ];
}
export function measure(
  rows: Data[],
  series: Record<string, Data>,
  minDaily: number,
  day: string,
  country: Record<string, Point[]> = {},
): number | null {
  for (const r of rows) r._pair = series[r.phrase]?.pair ?? [];
  const daily = benchDaily(rows);
  for (const r of rows) {
    const solo = series[r.phrase]?.solo ?? [],
      local = country[r.phrase];
    let s = local?.length ? shape(local, day, COUNTRY) : shape(solo, day);
    if (local?.length && !s.no_data) r.trend_geo = true;
    else if (local?.length) s = shape(solo, day);
    const z = size(r._pair, day, daily),
      own = ownPerDay(solo, r.volume ?? 0, r.month ?? "", day);
    delete r._pair;
    if (own !== null) z.per_day = own;
    Object.assign(r, s, z, { decision: decide(s, z.per_day, minDaily) });
  }
  return daily;
}
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
export async function run(
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
    [vol, c2] = await volumes(Object.keys(proposed).sort(), c.location_code),
    generic = Object.entries(proposed)
      .filter(([p]) => (vol[p]?.volume ?? 0) >= c.min_volume)
      .map(([p, r]) => ({ ...r, ...vol[p] }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, c.trends_max),
    rows: Data[] = [
      ...todo.map((n) => ({
        term: n,
        phrase: n,
        kind: "name",
        names: [],
        brand: true,
        evidence: "",
        ...vol[n],
      })),
      ...generic,
    ],
    [series, c3] = await fetchSeries(
      rows.map((r) => r.phrase),
      bench,
      day,
    ),
    [local, c4, localErrors] =
      goany.key() && c.country_trends
        ? await countrySeries(rows, c)
        : ([{}, 0, []] as [Record<string, Point[]>, number, string[]]),
    daily = measure(rows, series, c.min_daily, day, local),
    order: Record<string, number> = { prioritize: 0, watch: 1, skip: 2 };
  rows.sort(
    (a, b) =>
      order[a.decision] - order[b.decision] ||
      (b.per_day ?? 0) - (a.per_day ?? 0) ||
      (b.volume ?? 0) - (a.volume ?? 0),
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
    rows,
    proposed: asked,
    relevant: Object.keys(proposed).length,
    kept: generic.length,
    benchmark: bench,
    bench_daily: daily ? round(daily) : null,
    volume_month: generic.find((r) => r.month)?.month ?? "",
    no_evidence: todo.filter((n) => !ev[n].posts.length && !ev[n].readme),
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
    cost_micros: cost + c0 + c2 + c3 + c4,
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

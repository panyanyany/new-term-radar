import { settled } from "./review.js";
import {
  shift,
  days,
  mean,
  median,
  round,
  type Data,
  type Point,
} from "./core.js";
// 关键词日曲线的纯计算；保留旧接口与数值语义，不包含请求或状态写入。
export const WORLD = { unsettled: 2, window: 30, factor: 2, days: 2 },
  COUNTRY = { unsettled: 0, window: 10, factor: 1.5, days: 3 };
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
export function measure(
  rows: Data[],
  series: Record<string, Data>,
  minDaily: number,
  day: string,
  country: Record<string, Point[]> = {},
  benchmarkDaily?: number,
): number | null {
  for (const r of rows) r._pair = series[r.phrase]?.pair ?? [];
  const daily = benchmarkDaily ?? benchDaily(rows);
  for (const r of rows) {
    const solo = series[r.phrase]?.solo ?? [],
      local = country[r.phrase];
    let s = local?.length ? shape(local, day, COUNTRY) : shape(solo, day);
    if (local?.length && !s.no_data) r.trend_geo = true;
    else if (local?.length) s = shape(solo, day);
    const z = size(r._pair, day, daily),
      own = ownPerDay(solo, r.volume ?? 0, r.month ?? "", day);
    if (benchmarkDaily !== undefined) {
      // 最近七个稳定日期的关键词/参考词均值比；参考词为零时不猜量级。
      const recent = settled(r._pair ?? [], day).slice(-7),
        anchor = mean(recent.map((p) => p[2]));
      delete z.per_day;
      if (anchor > 0 && recent.length && !s.no_data) {
        const estimate =
          (mean(recent.map((p) => p[1])) / anchor) * benchmarkDaily;
        z.per_day = round(estimate);
        Object.assign(r, {
          volume: round(estimate * 30),
          volume_source: "trends_estimate",
        });
      }
    } else if (own !== null) z.per_day = own;
    delete r._pair;
    Object.assign(r, s, z, { decision: decide(s, z.per_day, minDaily) });
  }
  return daily;
}

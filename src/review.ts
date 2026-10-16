import {
  shift,
  today,
  mean,
  round,
  days,
  type Data,
  type Point,
  type Config,
} from "./core.js";
import { trendsMany, type TrendRequest } from "./scrappa.js";
import { Store } from "./store.js";
export const settled = (points: Point[], day: string) =>
  points.filter((p) => p[0] < shift(day, -2));
// 每个变体以自身基线判定，避免比较词的共同尺度压低小词。
export function rose(points: Point[], first: string): Data {
  const values = points.map((p) => p[1]);
  if (!values.length || Math.max(...values) === 0)
    return { rose: false, no_data: true };
  const base = mean(points.filter((p) => p[0] < first).map((p) => p[1])),
    peak_after = Math.max(
      0,
      ...points.filter((p) => p[0] >= first).map((p) => p[1]),
    ),
    peak = Math.max(...values),
    out: Data = {
      base: round(base, 1),
      peak_after,
      no_data: false,
      rose: peak_after >= Math.max(base * 2, base + 10),
    };
  if (out.rose)
    out.first_rise = points.find(
      (p) => p[1] >= Math.max(base + 0.25 * (peak - base), 1) && p[1] > base,
    )![0];
  return out;
}
export function verdict(
  per: Record<string, Data>,
  first: string,
): [string, number | null] {
  const risen = Object.values(per).filter((v) => v.rose);
  if (risen.length)
    return ["hit", days(risen.map((v) => v.first_rise).sort()[0], first)];
  return [
    Object.values(per).every((v) => v.no_data) ? "no_data" : "miss",
    null,
  ];
}
export function planCalls(
  due: [string, string, string[]][],
  day: string,
  after = 14,
): [TrendRequest[], [string[], string, string, string[]][]] {
  const calls: TrendRequest[] = [],
    plan: [string[], string, string, string[]][] = [];
  due.forEach(([term, first, variants], i) => {
    const keys = (variants.length ? variants : [term]).slice(0, 3),
      ids = keys.map((_, j) => `r${i}v${j}`);
    keys.forEach((k, j) =>
      calls.push({
        call_id: ids[j],
        keywords: [k],
        start: shift(first, -30),
        end: [shift(first, after), day].sort()[0],
      }),
    );
    plan.push([ids, term, first, keys]);
  });
  return [calls, plan];
}
export async function review(
  cfg: Config,
  store: Store,
  day = today(),
): Promise<Data> {
  const c = cfg.review,
    due = store.due(day, c.after_days, c.per_day);
  if (!due.length)
    return { checked: [], cost_micros: 0, after_days: c.after_days };
  const [calls, plan] = planCalls(due, day, c.after_days),
    [data, cost] = await trendsMany(calls),
    checked: Data[] = [];
  for (const [ids, term, first, keys] of plan) {
    if (!ids.every((id) => id in data)) continue;
    const per = Object.fromEntries(
        keys.map((k, j) => [k, rose(settled(data[ids[j]], day), first)]),
      ),
      [v, lead] = verdict(per, first);
    store.saveVerdict(term, v, lead, per, day);
    checked.push({ term, first_seen: first, verdict: v, lead_days: lead });
  }
  return { checked, cost_micros: cost, after_days: c.after_days };
}

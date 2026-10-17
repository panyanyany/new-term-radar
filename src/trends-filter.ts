import { sourceFailure, SourceDataError } from "./source-errors.js";
import { callMany } from "./scrappa.js";
import { errorText, mean, type Data } from "./core.js";

export type HourPoint = [
  timestampMs: number,
  candidate: number,
  benchmark: number,
];
export interface TrendDecision {
  status: "passed" | "pending" | "excluded";
  reason: string;
  first_nonzero_at?: string | null;
  recent_mean?: number;
  previous_mean?: number;
  nonzero_points?: number;
}
// 保留小时与参考词共同尺度，缺点、重复点和未覆盖七天的数据不能当作零。
export function hourlySeries(
  body: Data,
  keywords: string[],
  now: number,
): HourPoint[][] {
  if (!body || !Array.isArray(body.timeline_data))
    throw new SourceDataError("missing timeline_data");
  if (
    body.timeline_data.some(
      (p: unknown) => !p || typeof p !== "object" || Array.isArray(p),
    )
  )
    throw new SourceDataError("invalid timeline point");
  const points = body.timeline_data.filter(
    (p: Data) => !p.isPartial && !p.is_partial,
  );
  const start = now - 7 * 86400000;
  const result: HourPoint[][] = keywords.slice(1).map(() => []);
  for (const p of points) {
    if (!(
      (typeof p.timestamp === "string" && p.timestamp.trim() !== "") ||
      typeof p.timestamp === "number"
    ))
      throw new SourceDataError("invalid timestamp");
    const at = Number(p.timestamp) * 1000;
    if (!Number.isFinite(at)) throw new SourceDataError("invalid timestamp");
    // 即使上游漏标 partial，也不使用当前尚未结束的小时。
    if (at < start - 3600000 || at >= Math.floor(now / 3600000) * 3600000)
      continue;
    if (
      !Array.isArray(p.values) ||
      p.values.length !== keywords.length ||
      p.values.some(
        (v: Data, i: number) =>
          v?.query !== keywords[i] ||
          typeof v.value !== "number" ||
          !Number.isFinite(v.value) ||
          v.value < 0 ||
          v.value > 100 ||
          (v.has_data === false && v.value !== 0),
      )
    )
      throw new SourceDataError("invalid comparison values/order");
    result.forEach((series, i) =>
      series.push([at, p.values[i + 1].value, p.values[0].value]),
    );
  }
  for (const series of result) {
    series.sort((a, b) => a[0] - b[0]);
    if (
      series.length < 166 ||
      series[0][0] > start + 3600000 ||
      series.at(-1)![0] < now - 2 * 3600000 ||
      series.some((p, i) => i > 0 && p[0] - series[i - 1][0] !== 3600000)
    )
      throw new SourceDataError("incomplete seven-day hourly coverage");
  }
  return result;
}
// 以最新完整小时结束的两个 24 小时段比较，避开未结算点与单次尖峰。
export function zeroRise(series: HourPoint[]): TrendDecision {
  const pending = (reason: string): TrendDecision => ({
    status: "pending",
    reason,
  });
  if (
    series.length < 166 ||
    series.some(
      (p, i) =>
        !p.every(Number.isFinite) ||
        p[1] < 0 ||
        p[2] < 0 ||
        (i > 0 && p[0] - series[i - 1][0] !== 3600000),
    )
  )
    return pending("invalid_hourly_series");
  if (!series.some((p) => p[2] > 0)) return pending("invalid_benchmark");
  const first = series.findIndex((p) => p[1] > 0);
  const recent_mean = mean(series.slice(-24).map((p) => p[1]));
  const previous_mean = mean(series.slice(-48, -24).map((p) => p[1]));
  const details = {
    first_nonzero_at:
      first < 0 ? null : new Date(series[first][0]).toISOString(),
    recent_mean,
    previous_mean,
    nonzero_points: series.filter((p) => p[1] > 0).length,
  };
  let reason = "zero_then_rising";
  if (first < 0) reason = "all_zero";
  else if (first < 24) reason = "no_initial_24h_zero";
  else if (details.nonzero_points < 3) reason = "isolated_spike";
  else if (recent_mean <= previous_mean || recent_mean === 0)
    reason = "not_rising_recently";
  return {
    status: reason === "zero_then_rising" ? "passed" : "excluded",
    reason,
    ...details,
  };
}
// 仅唯一非零候选、参考词及其余候选全零时，认定该候选独占本批刻度。
export function dominantCurve(series: HourPoint[][]): number | undefined {
  if (series.length < 2 || series[0].some((p) => p[2] > 0)) return;
  const positive = series
    .map((curve, i) => ({ i, peak: Math.max(...curve.map((p) => p[1])) }))
    .filter((r) => r.peak > 0);
  return positive.length === 1 && positive[0].peak >= 90
    ? positive[0].i
    : undefined;
}
// 每批至多一次移除超大候选后的重查；不是网络失败重试，费用两次都入账。
export async function filterRootTrends(
  rows: Data[],
  benchmark: string,
  now = Date.now(),
): Promise<Data> {
  if (benchmark.includes(","))
    throw new Error("comparison benchmark contains comma");
  const checks: Data[] = [];
  // 错误示范：上游候选不是配置，不能让一个不可表达的词中断整批。
  const supported = rows.filter((row) => {
    if (!row.term.includes(",")) return true;
    checks.push({
      ...row,
      trend_filter: {
        status: "pending",
        reason: "unsupported_comparison_keyword",
        benchmark,
        checked_at: new Date(now).toISOString(),
      },
    });
    return false;
  });
  let cost_micros = 0;
  for (let i = 0; i < supported.length; i += 4) {
    let batch = supported.slice(i, i + 4);
    const attempts: Data[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const keywords = [benchmark, ...batch.map((r) => r.term)];
      const request = {
        q: keywords.join(","),
        geo: "Worldwide",
        time_range: "7d",
      };
      const currentAttempt: Data = {
        request,
        checked_at: new Date(now).toISOString(),
      };
      attempts.push(currentAttempt);
      try {
        const [bodies, cost] = await callMany([
          ["google-trends-interest", request],
        ]);
        cost_micros += cost;
        currentAttempt.cost_micros = cost;
        const series = hourlySeries(bodies[0], keywords, now);
        currentAttempt.curves = series;
        currentAttempt.decisions = series.map(zeroRise);
        const dominant = attempt === 0 ? dominantCurve(series) : undefined;
        if (dominant !== undefined) {
          const row = batch[dominant];
          currentAttempt.excluded_term = row.term;
          currentAttempt.reason = "dominates_comparison";
          checks.push({
            ...row,
            trend_filter: {
              status: "excluded",
              reason: "dominates_comparison",
              benchmark,
              request,
              curve: series[dominant],
              attempts: [...attempts],
              checked_at: new Date(now).toISOString(),
            },
          });
          batch = batch.filter((_, j) => j !== dominant);
          continue;
        }
        batch.forEach((row, j) =>
          checks.push({
            ...row,
            trend_filter: {
              ...zeroRise(series[j]),
              benchmark,
              request,
              curve: series[j],
              attempts: [...attempts],
              checked_at: new Date(now).toISOString(),
            },
          }),
        );
      } catch (e) {
        const diagnostic = sourceFailure(
          "hourly_curve",
          { terms: batch.map((r) => r.term), attempt, request },
          e,
        );
        currentAttempt.error = diagnostic;
        batch.forEach((row) =>
          checks.push({
            ...row,
            trend_filter: {
              status: "pending",
              reason: "curve_unavailable",
              error: errorText(e),
              diagnostic,
              benchmark,
              request,
              attempts: [...attempts],
              checked_at: new Date(now).toISOString(),
            },
          }),
        );
      }
      break;
    }
  }
  return {
    candidates: checks.filter((r) => r.trend_filter.status === "passed"),
    filtered: checks.filter((r) => r.trend_filter.status !== "passed"),
    cost_micros,
  };
}

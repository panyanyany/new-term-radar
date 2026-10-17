import { cachedCurve, rememberCurve } from "./research-cache.js";
import { termKey } from "./term-observations.js";
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
  breakout_reason?: string;
  trend_type?: "low_baseline_rise" | "existing_baseline_breakout";
  first_nonzero_at?: string | null;
  recent_mean?: number;
  previous_mean?: number;
  nonzero_points?: number;
  baseline_mean?: number;
  baseline_max?: number;
  baseline_nonzero_hours?: number;
  noise_threshold?: number;
  significant_points?: number;
  historical_mean?: number;
  pre_burst_mean?: number;
  recent_48h_mean?: number;
  burst_threshold?: number;
  burst_hours?: number;
  burst_window_hours?: number;
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
// 已有热度分别检查最近两天/三天；基线和临近对照始终取起涨窗口之前的数据。
function sustainedBreakout(series: HourPoint[]) {
  const recent = series.slice(-24).map((p) => p[1]);
  const windows = [48, 72].map((hours) => {
    const history = series.slice(0, -(hours + 24)).map((p) => p[1]);
    const historical_mean = mean(history);
    const pre_burst_mean = mean(
      series.slice(-(hours + 24), -hours).map((p) => p[1]),
    );
    const recent_48h_mean = mean(series.slice(-48).map((p) => p[1]));
    const burst_threshold = Math.max(historical_mean * 3, pre_burst_mean * 2);
    const burst_hours = recent.filter((v) => v >= burst_threshold).length;
    // 错误示范：把已上涨的第三天当成基线会漏词；只看峰值或窗口均值又会放行尖峰及回落。
    const passed =
      historical_mean > 0 &&
      history.filter((v) => v > 0).length >= 24 &&
      mean(series.slice(-hours).map((p) => p[1])) >= burst_threshold &&
      recent_48h_mean >= burst_threshold &&
      mean(recent) >= burst_threshold &&
      burst_hours >= 12;
    return {
      passed,
      historical_mean,
      pre_burst_mean,
      recent_48h_mean,
      burst_threshold,
      burst_hours,
      burst_window_hours: hours,
    };
  });
  return windows.find((window) => window.passed) ?? windows[0];
}
// 统一判定低基线起量或已有热度后的持续爆发，不改变数据完整性与参考词校验。
export function lowBaselineRise(series: HourPoint[]): TrendDecision {
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
  const baseline = series.slice(0, 24).map((p) => p[1]);
  const noise_threshold = Math.max(...series.map((p) => p[1])) * 0.1;
  // 错误示范：一个早期低值就淘汰会漏掉新起量词；用噪声凑满三个点又会放行孤立尖峰。
  const details = {
    baseline_mean: mean(baseline),
    baseline_max: Math.max(...baseline),
    baseline_nonzero_hours: baseline.filter((value) => value > 0).length,
    noise_threshold,
    significant_points: series.filter((p) => p[1] > noise_threshold).length,
    first_nonzero_at:
      first < 0 ? null : new Date(series[first][0]).toISOString(),
    recent_mean,
    previous_mean,
    nonzero_points: series.filter((p) => p[1] > 0).length,
  };
  let reason = "low_baseline_then_rising";
  if (first < 0) reason = "all_zero";
  else if (
    details.baseline_nonzero_hours > 3 ||
    details.baseline_max > noise_threshold
  )
    reason = "no_initial_24h_low_baseline";
  else if (details.significant_points < 3) reason = "isolated_spike";
  else if (recent_mean <= previous_mean || recent_mean === 0)
    reason = "not_rising_recently";
  const { passed: breakout, ...burstDetails } = sustainedBreakout(series);
  if (reason !== "low_baseline_then_rising" && breakout)
    reason = "existing_baseline_then_breakout";
  return {
    status: [
      "low_baseline_then_rising",
      "existing_baseline_then_breakout",
    ].includes(reason)
      ? "passed"
      : "excluded",
    reason,
    ...(![
      "all_zero",
      "low_baseline_then_rising",
      "existing_baseline_then_breakout",
    ].includes(reason)
      ? { breakout_reason: "no_sustained_2d_or_3d_breakout" }
      : {}),
    ...details,
    ...burstDetails,
    ...(reason === "low_baseline_then_rising"
      ? { trend_type: "low_baseline_rise" as const }
      : reason === "existing_baseline_then_breakout"
        ? { trend_type: "existing_baseline_breakout" as const }
        : {}),
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
  const curveKey = (term: string) =>
    JSON.stringify([
      termKey(term),
      benchmark,
      "Worldwide",
      "7d",
      Math.floor(now / 3600000),
      process.env.SCRAPPA_MCP_URL ?? "https://scrappa.co/mcp",
    ]);

  // 错误示范：上游候选不是配置，不能让一个不可表达的词中断整批。
  const supported = rows.filter((row) => {
    const previous = cachedCurve(curveKey(row.term));
    if (previous) {
      checks.push({ ...row, trend_filter: { ...previous, cache_hit: true } });
      return false;
    }
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
      // 类目仅属于 Rising 发现接口；曲线不可传类目，否则 hex picker 可能被过滤为零。
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
        currentAttempt.decisions = series.map(lowBaselineRise);
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
              ...lowBaselineRise(series[j]),
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
  for (const row of checks) rememberCurve(curveKey(row.term), row.trend_filter);
  return {
    candidates: checks.filter((r) => r.trend_filter.status === "passed"),
    filtered: checks.filter((r) => r.trend_filter.status !== "passed"),
    cost_micros,
  };
}

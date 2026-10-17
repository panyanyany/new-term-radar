import { unique, shift, type Data } from "./core.js";
import { trendsMany, type TrendRequest } from "./scrappa.js";
// 既有九十天比较查询独立于研究编排，公共导出保持兼容。
export async function fetchSeries(
  keywords: string[],
  benchmark: string,
  day: string,
): Promise<[Record<string, Data>, number]> {
  // 同一批次共享归一化比例；参考词固定第一列，其余最多四个词。
  const targets = unique(keywords).filter((k) => k !== benchmark),
    calls: TrendRequest[] = [];
  for (let i = 0; i < targets.length; i += 4)
    calls.push({
      call_id: `b${i / 4}`,
      keywords: [benchmark, ...targets.slice(i, i + 4)],
      start: shift(day, -90),
      end: day,
    });
  if (!calls.length && keywords.includes(benchmark))
    calls.push({
      call_id: "b0",
      keywords: [benchmark],
      start: shift(day, -90),
      end: day,
    });
  const [data, cost] = await trendsMany(calls),
    out: Record<string, Data> = {};
  for (const call of calls) {
    const points = data[call.call_id] ?? [];
    for (let i = 1; i < call.keywords.length; i++)
      out[call.keywords[i]] = {
        solo: points.map((p) => [p[0], p[i + 1]]),
        pair: points.map((p) => [p[0], p[i + 1], p[1]]),
      };
    if (keywords.includes(benchmark) && !out[benchmark])
      out[benchmark] = {
        solo: points.map((p) => [p[0], p[1]]),
        pair: points.map((p) => [p[0], p[1], p[1]]),
      };
  }
  return [out, cost];
}

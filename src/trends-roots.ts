import { termKey } from "./term-observations.js";
import { DEFAULT_TRENDS_CATEGORY } from "./trends-config.js";
import { sourceFailure, SourceDataError } from "./source-errors.js";
import { researchCandidates } from "./candidate-research.js";
import { filterRootTrends } from "./trends-filter.js";
import { call, key } from "./aisa.js";
import {
  errorText,
  jsonFetch,
  shift,
  utcToday,
  type Config,
  type Data,
} from "./core.js";

import { expandSecondLevel, type SaveSecondLevel } from "./trends-expansion.js";
export { exceedsReference, rankSecondLevel } from "./trends-expansion.js";
const TOOL = "any_dataforseo_apis_v1_dataforseo_keywords_data_g_f56cfb";
// 三天使用 UTC 日期区间，接口只支持日期精度，不宣称精确滚动 72 小时。
export function requestFor(
  root: string,
  window: number,
  day = utcToday(),
  category_code = DEFAULT_TRENDS_CATEGORY,
): Data {
  if (![1, 3, 7].includes(window)) throw new Error("unsupported Trends window");
  return {
    keywords: [root],
    category_code,
    item_types: ["google_trends_queries_list"],
    type: "web",
    language_code: "en",
    ...(window === 3
      ? { date_from: shift(day, -3), date_to: day }
      : { time_range: window === 1 ? "past_day" : "past_7_days" }),
  };
}
// 只接受显式 rising 列表，平铺或仅 top 的响应必须失败，不能冒充上涨词。
export function risingRows(data: Data): { rows: Data[]; check_url: string } {
  if (data.status_code !== 20000 || data.tasks_error)
    throw new SourceDataError("Trends task failed");
  const task = data.tasks?.[0];
  if (task?.status_code !== 20000)
    throw new SourceDataError("Trends task failed");
  const result = task.result?.[0];
  const item = result?.items?.find(
    (r: Data) => r.type === "google_trends_queries_list",
  );
  if (!Array.isArray(item?.data?.rising))
    throw new SourceDataError("Trends response missing explicit rising");
  if (
    item.data.rising.some(
      (r: Data) => typeof r.query !== "string" || !r.query.trim(),
    )
  )
    throw new SourceDataError("invalid rising query");
  return { rows: item.data.rising, check_url: result.check_url };
}
// 相关查询只负责 Rising 获取与归并，配置根词和曲线触发扩展共用接口契约。
export async function discoverRelated(
  cfg: Config,
  roots: string[],
): Promise<Data> {
  if (!roots.length) return { candidates: [], windows: [], cost_micros: 0 };
  // 一级扩展数量不固定，按现有路由单批 20 个请求的限制拆批。
  const batchSize = Math.floor(20 / cfg.trends_roots.windows.length);
  if (roots.length > batchSize) {
    const merged = new Map<string, Data>();
    const windows: Data[] = [];
    let cost_micros = 0;
    for (let i = 0; i < roots.length; i += batchSize) {
      const batch = await discoverRelated(cfg, roots.slice(i, i + batchSize));
      windows.push(...batch.windows);
      cost_micros += batch.cost_micros;
      for (const row of batch.candidates) {
        const k = termKey(row.term);
        const previous = merged.get(k);
        if (previous) previous.appearances.push(...row.appearances);
        else merged.set(k, row);
      }
    }
    return { candidates: [...merged.values()], windows, cost_micros };
  }
  const calls = roots.flatMap((root, i) =>
    cfg.trends_roots.windows.map((window) => ({
      call_id: `root_${i}_${window}`,
      tool: TOOL,
      arguments: {
        body: [
          requestFor(
            root,
            window,
            utcToday(),
            cfg.trends_roots.category_code ?? DEFAULT_TRENDS_CATEGORY,
          ),
        ],
      },
    })),
  );
  const quote = await jsonFetch(
    (process.env.AISA_ROUTER_BASE_URL ?? "https://tools.aisa.one") +
      "/v1/tool-router/aisa-batch-quote",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ calls }),
    },
    90000,
  );
  if (
    quote.error ||
    !Array.isArray(quote.results) ||
    quote.results.length !== calls.length ||
    quote.results.some((r: Data) => !r.successful)
  )
    throw new SourceDataError("Trends quote failed");
  const [results, cost_micros] = await call(calls);
  const windows: Data[] = [],
    candidates = new Map<string, Data>();
  for (const c of calls) {
    const request = c.arguments.body[0];
    try {
      const parsed = risingRows(results[c.call_id] ?? {});
      // 核对 Google 回显范围，防止上游忽略三天参数。
      const url = new URL(parsed.check_url);
      const expected = request.date_from
        ? `${request.date_from} ${request.date_to}`
        : request.time_range === "past_day"
          ? "now 1-d"
          : "now 7-d";
      if (
        url.searchParams.get("q") !== request.keywords[0] ||
        url.searchParams.get("date") !== expected ||
        Number(url.searchParams.get("cat") ?? 0) !== request.category_code
      )
        throw new SourceDataError("Trends echoed range mismatch");
      windows.push({
        call_id: c.call_id,
        request,
        check_url: parsed.check_url,
        count: parsed.rows.length,
      });
      for (const r of parsed.rows) {
        const k = termKey(r.query);
        const row = candidates.get(k) ?? {
          term: r.query.trim(),
          appearances: [],
        };
        row.appearances.push({
          root: request.keywords[0],
          request,
          growth: r.value,
          discovery_level: 1,
          root_path: [request.keywords[0], r.query.trim()],
        });
        candidates.set(k, row);
      }
    } catch (e) {
      sourceFailure("rising", { call_id: c.call_id, request }, e);
      windows.push({ call_id: c.call_id, request, error: errorText(e) });
    }
  }
  return { candidates: [...candidates.values()], windows, cost_micros };
}

// 根词发现先过七天曲线筛选，再逐词 Google 搜索取证；搜索失败仍保留通过的词。
export async function discoverRoots(
  cfg: Config,
  onDiscovered?: (rows: { term: string }[]) => void,
  saveSecondLevel?: SaveSecondLevel,
): Promise<Data> {
  const related = await discoverRelated(cfg, cfg.trends_roots.roots);
  // 错误示范：等到分类通过才写首次发现，会把旧词误标成新词。
  onDiscovered?.(related.candidates);
  const screening = await filterRootTrends(
    related.candidates,
    cfg.trends_roots.benchmark ?? cfg.usecases.benchmark,
  );
  const firstClassified = await researchCandidates(
    screening.candidates,
    cfg.usecases.model,
  );
  // 必须完成一级曲线、取证、分类和赛事门禁后，才允许产生二级词。
  const expansion = await expandSecondLevel(
    cfg,
    related.candidates,
    { candidates: firstClassified.candidates },
    onDiscovered,
    discoverRelated,
    saveSecondLevel,
  );
  const classified = await researchCandidates(
    expansion.candidates,
    cfg.usecases.model,
  );
  return {
    candidates: [
      ...firstClassified.candidates.map((row: Data) => ({
        ...row,
        appearances: expansion.first_appearances[termKey(row.term)],
      })),
      ...classified.candidates,
    ],
    classification_filtered: [
      ...firstClassified.filtered,
      ...classified.filtered,
    ],
    filtered: [...screening.filtered, ...expansion.filtered],
    windows: [...related.windows, ...expansion.windows],
    expansion: expansion.triggers,
    second_level: expansion.snapshot,
    cost_micros:
      related.cost_micros + screening.cost_micros + expansion.cost_micros,
    cost_complete: false, // 此处仅含 Rising 和曲线；完整费用从请求账本读取。
  };
}

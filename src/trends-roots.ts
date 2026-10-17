import { DEFAULT_TRENDS_CATEGORY } from "./trends-config.js";
import { sourceFailure, SourceDataError } from "./source-errors.js";
import { classifyCandidates } from "./candidate-kind.js";
import { filterRootTrends } from "./trends-filter.js";
import { call, key } from "./aisa.js";
import { googleSearchResult } from "./scrappa.js";
import {
  errorText,
  jsonFetch,
  shift,
  utcToday,
  type Config,
  type Data,
} from "./core.js";

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
// 根词发现先过七天曲线筛选，再逐词 Google 搜索取证；搜索失败仍保留通过的词。
export async function discoverRoots(
  cfg: Config,
  onDiscovered?: (rows: { term: string }[]) => void,
): Promise<Data> {
  const roots = cfg.trends_roots.roots;
  if (!roots.length) return { candidates: [], windows: [] };
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
        const k = r.query.trim().normalize("NFKC").toLowerCase();
        const row = candidates.get(k) ?? {
          term: r.query.trim(),
          appearances: [],
        };
        row.appearances.push({
          root: request.keywords[0],
          request,
          growth: r.value,
        });
        candidates.set(k, row);
      }
    } catch (e) {
      sourceFailure("rising", { call_id: c.call_id, request }, e);
      windows.push({ call_id: c.call_id, request, error: errorText(e) });
    }
  }
  // 错误示范：等到分类通过才写首次发现，会把旧词误标成新词。
  onDiscovered?.([...candidates.values()] as { term: string }[]);
  const screening = await filterRootTrends(
    [...candidates.values()],
    cfg.trends_roots.benchmark ?? cfg.usecases.benchmark,
  );
  const rows: Data[] = screening.candidates;
  // 搜索资料完整保留；失败交给分类阶段标记待确认，不自动付费重试。
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, rows.length) }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        try {
          const result = await googleSearchResult(row.term, "broad");
          row.evidence = result.evidence;
          row.search_response = {
            query: result.query,
            organic_results: result.rawResults,
          };
        } catch (e) {
          sourceFailure("google_search", { term: row.term }, e);
          row.search_error = errorText(e);
          row.evidence = [];
        }
        row.context = row.evidence.length
          ? `Google 搜索资料：${JSON.stringify(row.evidence)}`
          : "Google 搜索未找到可核实资料，必须标注含义待确认，不可推测。";
      }
    }),
  );
  const classified = await classifyCandidates(rows, cfg.usecases.model);
  // 后续解释优先使用分类所引用的相关证据，完整搜索结果仍保留在原字段中。
  for (const row of classified.candidates) {
    const indices: number[] = row.classification?.evidence_indices ?? [];
    if (indices.length)
      row.context = `Google 搜索资料：${JSON.stringify(indices.map((i) => row.evidence[i]))}`;
  }
  return {
    candidates: classified.candidates,
    classification_filtered: classified.filtered,
    filtered: screening.filtered,
    windows,
    cost_micros: cost_micros + screening.cost_micros,
    cost_complete: false, // 此处仅含 Rising 和曲线；完整费用从请求账本读取。
  };
}

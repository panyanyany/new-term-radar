import { termKey } from "./term-observations.js";
import { sourceFailure, SourceDataError } from "./source-errors.js";
import { call, key } from "./aisa.js";
import {
  errorText,
  jsonFetch,
  utcToday,
  type Config,
  type Data,
} from "./core.js";
import { DEFAULT_TRENDS_CATEGORY } from "./trends-config.js";
import { requestFor, risingRows, validateRange } from "./trends-contract.js";
const TOOL = "any_dataforseo_apis_v1_dataforseo_keywords_data_g_f56cfb";
// 相关查询只负责 Rising 获取与归并，配置根词和曲线触发扩展共用接口契约。
export async function discoverAisaRelated(
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
      const batch = await discoverAisaRelated(
        cfg,
        roots.slice(i, i + batchSize),
      );
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
      validateRange(parsed.check_url, request);
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

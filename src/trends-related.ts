import { collectionStatus } from "./trends-status.js";
import { requestFor, risingRows, validateRange } from "./trends-contract.js";
export { requestFor, risingRows } from "./trends-contract.js";
import { DEFAULT_TRENDS_CATEGORY } from "./trends-config.js";
import { sourceFailure } from "./source-errors.js";
import { utcToday, errorText, type Config, type Data } from "./core.js";
import { termKey } from "./term-observations.js";
import { discoverAisaRelated } from "./trends-aisa.js";
import { standardRelated, resumeStandard } from "./dataforseo-standard.js";
import { type StandardTask } from "./dataforseo-store.js";
// Standard 与 AIsa 共用 Rising 和范围校验；异步批量返回不改变业务候选契约。
export function parseStandard(
  batch: { batch_id: string; tasks: StandardTask[] },
  chargeSubmission = true,
): Data {
  const candidates = new Map<string, Data>(),
    windows: Data[] = [];
  for (const task of batch.tasks) {
    const { call_id, request, task_id, status } = task;
    const info = {
      call_id,
      request,
      task_id,
      batch_id: batch.batch_id,
      provider: "dataforseo",
      status,
    };
    if (status !== "completed" || !task.response) {
      windows.push({
        ...info,
        error:
          task.error ??
          (status === "submitted"
            ? "Standard wait timeout; resume by batch ID"
            : status),
      });
      continue;
    }
    try {
      const parsed = risingRows(task.response);
      validateRange(parsed.check_url, request);
      windows.push({
        ...info,
        check_url: parsed.check_url,
        count: parsed.rows.length,
      });
      for (const row of parsed.rows) {
        const key = termKey(row.query);
        const previous = candidates.get(key) ?? {
          term: row.query.trim(),
          appearances: [],
        };
        previous.appearances.push({
          root: request.keywords[0],
          request,
          growth: row.value,
          discovery_level: 1,
          root_path: [request.keywords[0], row.query.trim()],
        });
        candidates.set(key, previous);
      }
    } catch (e) {
      sourceFailure("rising", info, e);
      windows.push({ ...info, error: errorText(e) });
    }
  }
  return {
    candidates: [...candidates.values()],
    windows,
    collection_status: collectionStatus(windows),
    batch_id: batch.batch_id,
    cost_micros: chargeSubmission
      ? batch.tasks.reduce((sum, task) => sum + (task.cost_micros ?? 0), 0)
      : 0,
    cost_complete:
      !chargeSubmission ||
      batch.tasks.every((task) => task.cost_micros !== null),
  };
}
export async function discoverRelated(
  cfg: Config,
  roots: string[],
  state = process.env.RADAR_STATE ?? "state",
): Promise<Data> {
  if (!roots.length) return { candidates: [], windows: [], cost_micros: 0 };
  const provider = cfg.trends_roots.provider ?? "dataforseo";
  if (provider === "aisa") return discoverAisaRelated(cfg, roots);
  if (provider !== "dataforseo")
    throw new Error("trends_roots.provider: dataforseo | aisa");
  const day = utcToday();
  const requests = roots.flatMap((root, i) =>
    cfg.trends_roots.windows.map((window) => ({
      call_id: `root_${i}_${window}`,
      request: requestFor(
        root,
        window,
        day,
        cfg.trends_roots.category_code ?? DEFAULT_TRENDS_CATEGORY,
      ),
    })),
  );
  return parseStandard(
    await standardRelated(state, requests, {
      wait_ms:
        cfg.trends_roots.standard_wait_minutes == null
          ? undefined
          : cfg.trends_roots.standard_wait_minutes * 60000,
    }),
  );
}
// 恢复只收取并解析已提交批次，不自动研究、发送通知或回灌历史日报。
export async function resumeRelated(state: string, batch: string, cfg: Config) {
  return parseStandard(
    await resumeStandard(state, batch, {
      wait_ms:
        cfg.trends_roots.standard_wait_minutes == null
          ? undefined
          : cfg.trends_roots.standard_wait_minutes * 60000,
    }),
    false,
  );
}

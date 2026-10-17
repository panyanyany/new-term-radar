import { filterRootTrends } from "./trends-filter.js";
import { researchCandidates } from "./candidate-research.js";
import { Store } from "./store.js";
import { rememberDiscoveries, termKey } from "./term-observations.js";
import { type Config, type Data } from "./core.js";

// 网页去重仍由快照负责；此处仅研究本轮新增词，不从历史回灌候选。
export async function researchPages(
  cfg: Config,
  state: string,
  pages: Data,
): Promise<Data> {
  const unique = new Map<string, Data & { term: string }>();
  for (const row of pages.candidates ?? []) {
    if (!row.keyword) continue;
    const key = termKey(row.keyword);
    const candidate = unique.get(key) ?? {
      term: row.keyword,
      page_evidence: [],
    };
    candidate.page_evidence.push({
      title: row.keyword,
      text: [...(row.anchors ?? []), row.explanation ?? ""].join("; "),
      url: row.url,
      source: "page",
    });
    unique.set(key, candidate);
  }
  const rows = [...unique.values()];
  if (!rows.length) return { ...pages, classification_filtered: [] };
  const store = new Store(state);
  try {
    rememberDiscoveries(
      store,
      rows,
      pages.created_at ? new Date(pages.created_at) : new Date(),
    );
  } finally {
    store.close();
  }
  const curves = await filterRootTrends(
    rows,
    cfg.trends_roots.benchmark ?? cfg.usecases.benchmark,
  );
  // 所有来源统一曲线门槛：不达标或待验证的网页词保留诊断，不再进入搜索与分类。
  const classified = await researchCandidates(
    curves.candidates,
    cfg.usecases.model,
  );
  const accepted = new Map<string, Data>(
    classified.candidates.map((r: Data) => [termKey(r.term), r]),
  );
  const candidates = (pages.candidates ?? [])
    .filter((row: Data) => accepted.has(termKey(row.keyword ?? "")))
    .map((row: Data) => ({ ...row, ...accepted.get(termKey(row.keyword)) }));
  return {
    ...pages,
    candidates,
    classification_filtered: classified.filtered,
    curve_filtered: curves.filtered,
    cost_micros: curves.cost_micros,
    cost_complete: false,
  };
}

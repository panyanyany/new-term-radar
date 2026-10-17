import { named } from "./report.js";
import { collectTerms, type BriefTerm } from "./report-terms.js";
import { filterRootTrends } from "./trends-filter.js";
import { researchCandidates } from "./candidate-research.js";
import { rememberDiscoveries, termKey } from "./term-observations.js";
import { type Store } from "./store.js";
import { type Config, type Data } from "./core.js";

export interface ScreenedTerms {
  rows: BriefTerm[];
  candidates: Data[];
  filtered: Data[];
  classification_filtered: Data[];
  cost_micros: number;
  cost_complete: false;
}

// 日报前的统一关口覆盖线索、关键词研究及其他来源，复用已经完成的根词/网页研究。
export async function screenReportTerms(
  cfg: Config,
  store: Store,
  lead: Data[],
  blocks: Data,
  keywords: Data,
): Promise<ScreenedTerms> {
  const current = collectTerms(named(cfg, lead).slice(0, 20), blocks, keywords);
  rememberDiscoveries(store, current);
  const pages = blocks.sitemap?.pages ?? {};
  const roots = blocks.trends ?? {};
  const blocked = new Set(
    [
      ...(roots.filtered ?? []),
      ...(roots.classification_filtered ?? []),
      ...(pages.curve_filtered ?? []),
      ...(pages.classification_filtered ?? []),
    ].map((r: Data) => termKey(r.term)),
  );
  const checked = new Map<string, Data>(
    [...(roots.candidates ?? []), ...(pages.candidates ?? [])].map(
      (r: Data) => [termKey(r.term ?? r.keyword), r],
    ),
  );
  const pending = current.filter(
    (r) => !blocked.has(termKey(r.term)) && !checked.has(termKey(r.term)),
  );
  const curves = pending.length
    ? await filterRootTrends(
        pending,
        cfg.trends_roots.benchmark ?? cfg.usecases.benchmark,
      )
    : { candidates: [], filtered: [], cost_micros: 0 };
  const classified = await researchCandidates(
    curves.candidates,
    cfg.usecases.model,
  );
  for (const row of classified.candidates) checked.set(termKey(row.term), row);
  // 错误示范：已有解释或来自其他来源，不能绕过曲线通过状态与赛事拦截。
  const rows: BriefTerm[] = current
    .filter((row) => {
      const key = termKey(row.term),
        result = checked.get(key);
      return (
        !blocked.has(key) &&
        result?.trend_filter?.status === "passed" &&
        result?.classification?.is_offline_sports_event !== true
      );
    })
    .map((row) => ({
      ...row,
      context: checked.get(termKey(row.term))?.context ?? row.context,
    }));
  const keys = new Set(rows.map((row) => termKey(row.term)));
  return {
    rows,
    candidates: [...checked.values()].filter((row) =>
      keys.has(termKey(row.term ?? row.keyword)),
    ),
    filtered: curves.filtered,
    classification_filtered: classified.filtered,
    cost_micros: curves.cost_micros,
    cost_complete: false,
  };
}

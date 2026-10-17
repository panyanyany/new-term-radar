import { collectionStatus } from "./trends-status.js";
import { termKey } from "./term-observations.js";
import { researchCandidates } from "./candidate-research.js";
import { filterRootTrends } from "./trends-filter.js";
import { type Config, type Data } from "./core.js";
import { discoverRelated } from "./trends-related.js";
export { discoverRelated, requestFor, risingRows } from "./trends-related.js";
import { expandSecondLevel, type SaveSecondLevel } from "./trends-expansion.js";
export { exceedsReference, rankSecondLevel } from "./trends-expansion.js";
// 根词发现先过七天曲线筛选，再逐词 Google 搜索取证；搜索失败仍保留通过的词。
export async function discoverRoots(
  cfg: Config,
  onDiscovered?: (rows: { term: string }[]) => void,
  saveSecondLevel?: SaveSecondLevel,
  state = process.env.RADAR_STATE ?? "state",
): Promise<Data> {
  const query = (config: Config, roots: string[]) =>
    discoverRelated(config, roots, state);
  const related = await query(cfg, cfg.trends_roots.roots);
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
    query,
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
    collection_status: collectionStatus([
      ...related.windows,
      ...expansion.windows,
    ]),
    expansion: expansion.triggers,
    second_level: expansion.snapshot,
    cost_micros:
      related.cost_micros + screening.cost_micros + expansion.cost_micros,
    cost_complete: false, // 此处仅含 Rising 和曲线；完整费用从请求账本读取。
  };
}

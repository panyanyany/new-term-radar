import { type Config, type Data, errorText } from "./core.js";
import { termKey } from "./term-observations.js";
import { sourceFailure } from "./source-errors.js";
import { filterRootTrends } from "./trends-filter.js";

import { SECOND_LEVEL_LIMIT, SECOND_LEVEL_SORT } from "./trends-config.js";
export interface Appearance {
  root: string;
  request: Data;
  growth?: unknown;
  discovery_level?: number;
  root_path?: string[];
}
export interface Priority {
  breakout: boolean;
  max_growth: number | null;
  window_count: number;
  parent_count: number;
  rank: number;
}
export interface Candidate extends Data {
  term: string;
  appearances: Appearance[];
  priority?: Priority;
}
export interface SecondLevelSnapshot {
  sorting_strategy: typeof SECOND_LEVEL_SORT;
  created_at: string;
  limit: number;
  discovered: Candidate[];
  deferred: Candidate[];
  triggers: Data[];
  windows: Data[];
}
export type SaveSecondLevel = (snapshot: SecondLevelSnapshot) => string;
type RelatedQuery = (cfg: Config, roots: string[]) => Promise<Data>;

// 同一时刻、同一尺度比较；参考值为零表示无法可靠计算倍数，不能当成无限倍。
export function exceedsReference(curve: unknown): boolean {
  return (
    Array.isArray(curve) &&
    curve.some(
      (point: unknown) =>
        Array.isArray(point) &&
        point.length === 3 &&
        point.every(
          (value: unknown) =>
            typeof value === "number" && Number.isFinite(value),
        ) &&
        point[2] > 0 &&
        point[1] > point[2] * 3,
    )
  );
}

// 仅一级词触发二级 Rising；继承来源类目，复用七天曲线硬门槛，不递归。
export async function expandSecondLevel(
  cfg: Config,
  first: Candidate[],
  screening: { candidates: Candidate[] },
  onDiscovered: ((rows: { term: string }[]) => void) | undefined,
  discoverRelated: RelatedQuery,
  saveSecondLevel?: SaveSecondLevel,
): Promise<Data> {
  // 克隆输入来源，二级入口合并不改变一级筛选结果或调用者数据。
  const origins = new Map(
    first.map((row) => [termKey(row.term), structuredClone(row)]),
  );
  const groups = new Map<number, Map<string, Candidate>>();
  for (const row of screening.candidates) {
    if (
      row.trend_filter?.status !== "passed" ||
      row.classification?.is_offline_sports_event === true ||
      !exceedsReference(row.trend_filter?.curve)
    )
      continue;
    const origin = origins.get(termKey(row.term));
    if (!origin) continue;
    for (const appearance of origin.appearances ?? []) {
      const category = appearance.request.category_code;
      const group = groups.get(category) ?? new Map<string, Candidate>();
      group.set(row.term, origin);
      groups.set(category, group);
    }
  }
  const seen = origins;
  const second = new Map<string, Candidate>();
  const windows: Data[] = [],
    triggers: Data[] = [];
  let cost_micros = 0;
  for (const [category, parents] of groups) {
    // 汇总全部合格父词的相关查询，再统一排序；十词限制约束后续研究。
    for (const parentTerm of parents.keys()) {
      const roots = [parentTerm];
      triggers.push(
        ...roots.map((term) => ({
          term,
          category_code: category,
          reason: "exceeds_reference_3x",
          discovery_level: 1,
        })),
      );
      let related: Data;
      try {
        related = await discoverRelated(
          {
            ...cfg,
            trends_roots: { ...cfg.trends_roots, category_code: category },
          },
          roots,
        );
      } catch (e) {
        sourceFailure(
          "second_level_rising",
          { roots, category_code: category },
          e,
        );
        windows.push({
          roots,
          category_code: category,
          discovery_level: 2,
          error: errorText(e),
        });
        continue;
      }
      cost_micros += related.cost_micros;
      windows.push(
        ...related.windows.map((window: Data) => ({
          ...window,
          discovery_level: 2,
        })),
      );
      for (const original of related.candidates) {
        const row: Candidate = structuredClone(original);
        row.appearances = row.appearances.flatMap((appearance) => {
          const parent = parents.get(appearance.root)!;
          return parent.appearances
            .filter(
              (a) =>
                a.discovery_level !== 2 && a.request.category_code === category,
            )
            .map((a) => ({
              ...appearance,
              discovery_level: 2,
              root_path: [a.root, parent.term, row.term],
            }));
        });
        const key = termKey(row.term);
        // 错误示范：返回父词或已有一级词时重新入队，会重复收费甚至形成循环。
        const existing = seen.get(key) ?? second.get(key);
        if (existing) existing.appearances.push(...row.appearances);
        else if (!cfg.trends_roots.roots.some((root) => termKey(root) === key))
          second.set(key, row);
      }
    }
  }
  const ranked = rankSecondLevel([...second.values()]);
  const rows = ranked.slice(0, SECOND_LEVEL_LIMIT);
  const deferred = ranked.slice(SECOND_LEVEL_LIMIT).map((row) => ({
    ...row,
    status: "deferred",
    reason: "second_level_limit",
  }));
  onDiscovered?.(ranked.map((row) => ({ term: String(row.term) })));
  const snapshot: SecondLevelSnapshot = {
    sorting_strategy: SECOND_LEVEL_SORT,
    created_at: new Date().toISOString(),
    limit: SECOND_LEVEL_LIMIT,
    discovered: rows,
    deferred,
    triggers,
    windows,
  };
  // 错误示范：等曲线、AI 或整轮日报完成后才存来源，中止会丢失已付费获取的证据。
  const batch_id = saveSecondLevel?.(snapshot);
  const screened = rows.length
    ? await filterRootTrends(
        rows,
        cfg.trends_roots.benchmark ?? cfg.usecases.benchmark,
      )
    : { candidates: [], filtered: [], cost_micros: 0 };
  return {
    ...screened,
    windows,
    triggers,
    snapshot: { ...snapshot, batch_id },
    first_appearances: Object.fromEntries(
      [...origins].map(([key, row]) => [key, row.appearances]),
    ),
    discovered: rows,
    deferred,
    cost_micros: cost_micros + screened.cost_micros,
  };
}

// Rising 增长信号只代表研究优先级，不代替七天曲线及赛事门禁。
export function rankSecondLevel(
  rows: Candidate[],
): (Candidate & { priority: Priority })[] {
  const scored = rows.map((row) => {
    const appearances = row.appearances;
    let breakout = false,
      max_growth: number | null = null;
    const windows = new Set<string>(),
      parents = new Set<string>();
    for (const a of appearances) {
      if (typeof a.growth === "string" && /^breakout$/i.test(a.growth.trim()))
        breakout = true;
      const growth =
        typeof a.growth === "number"
          ? a.growth
          : typeof a.growth === "string" &&
              /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?%?$/.test(a.growth.trim())
            ? Number(a.growth.replace(/[, %]/g, ""))
            : NaN;
      if (Number.isFinite(growth) && growth >= 0)
        max_growth = Math.max(max_growth ?? 0, growth);
      const request = a.request ?? {};
      windows.add(
        JSON.stringify([
          request.time_range ?? null,
          request.date_from ?? null,
          request.date_to ?? null,
        ]),
      );
      parents.add(termKey(a.root));
    }
    return {
      ...row,
      term: String(row.term),
      priority: {
        breakout,
        max_growth,
        window_count: windows.size,
        parent_count: parents.size,
      },
    };
  });
  scored.sort(
    (a, b) =>
      Number(b.priority.breakout) - Number(a.priority.breakout) ||
      Number(b.priority.max_growth !== null) -
        Number(a.priority.max_growth !== null) ||
      (b.priority.max_growth ?? 0) - (a.priority.max_growth ?? 0) ||
      b.priority.window_count - a.priority.window_count ||
      b.priority.parent_count - a.priority.parent_count ||
      (termKey(a.term) < termKey(b.term)
        ? -1
        : termKey(a.term) > termKey(b.term)
          ? 1
          : 0),
  );
  return scored.map((row, i) => ({
    ...row,
    priority: { ...row.priority, rank: i + 1 },
  }));
}

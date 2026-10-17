import { expect, it } from "vitest";
import { load } from "cheerio";
import { renderSite } from "../src/site.js";
const date = new Date("2026-10-17T12:00:00Z");

it("结构化分类依据保留换行及伪阶段前缀，不增加发现入口", () => {
  const reason =
    '第一行\nGoogle 搜索：不是查询\n<img src=x onerror="alert(1)">';
  const $ = load(
    renderSite(
      {
        brief_terms: [{ term: "multiline", first_seen_at: date.toISOString() }],
        trends: {
          candidates: [
            {
              term: "multiline",
              classification: {
                decision: "uncertain",
                is_online_game: false,
                is_online_tool: false,
                reason,
              },
            },
          ],
        },
      },
      date,
    ),
  );
  const steps = JSON.parse($(".term-trigger").attr("data-birth-path")!);
  expect(
    steps.filter((s: { kind: string }) => s.kind === "source"),
  ).toHaveLength(1);
  expect(steps.find((s: { kind: string }) => s.kind === "reason").text).toBe(
    reason,
  );
  expect($(".term-trigger img")).toHaveLength(0);
});

it("新旧报告排序说明不同，增长缺失显示未记录，零增长保留0%", () => {
  const report = (strategy?: string) => ({
    brief_terms: [],
    trends: {
      candidates: [],
      second_level: {
        sorting_strategy: strategy,
        deferred: [
          {
            term: "missing",
            priority: { rank: 11, breakout: false, max_growth: null },
          },
          {
            term: "zero",
            priority: { rank: 12, breakout: false, max_growth: 0 },
          },
        ],
      },
    },
  });
  const current = load(renderSite(report("rising-v1"), date));
  expect(current("#deferred .note").text()).toContain("统一按 Rising");
  expect(current("#deferred tbody tr").eq(0).text()).toContain("未记录");
  expect(current("#deferred tbody tr").eq(1).text()).toContain("0%");
  const legacy = load(renderSite(report(), date));
  expect(legacy("#deferred .note").text()).toContain("历史报告未记录排序策略");
  expect(legacy("#deferred .note").text()).not.toContain("统一按 Rising");
});

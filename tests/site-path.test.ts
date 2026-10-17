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

it("仅超限二级候选四词一组，各组首词为参考词且曲线链接不带类目", () => {
  const deferred = Array.from({ length: 9 }, (_, i) => ({
    term: `pending ${i}`,
  }));
  const $ = load(
    renderSite(
      {
        brief_terms: [],
        trends: {
          candidates: [
            {
              term: "already studied",
              trend_filter: { benchmark: "custom reference" },
            },
          ],
          second_level: { discovered: [{ term: "already studied" }], deferred },
        },
      },
      date,
    ),
  );
  const links = $(".trend-group");
  expect(links).toHaveLength(3);
  const groups = links.toArray().map((a) => {
    const url = new URL($(a).attr("href")!);
    expect(url.searchParams.get("date")).toBe("now 7-d");
    expect(url.searchParams.has("cat")).toBe(false);
    expect(url.searchParams.has("category_code")).toBe(false);
    return url.searchParams.get("q")!.split(",");
  });
  expect(groups.map((g) => g.length)).toEqual([5, 5, 2]);
  expect(groups.every((g) => g[0] === "custom reference")).toBe(true);
  expect(groups.flatMap((g) => g.slice(1))).toEqual(
    deferred.map((row) => row.term),
  );
  expect(links.text()).not.toContain("already studied");
});

it("分组名称转义、去重，不重复参考词；所有外部链接禁止发送来源信息", () => {
  const term = '<img src=x onerror="alert(1)"> & 中文';
  const $ = load(
    renderSite(
      {
        brief_terms: [{ term: "studied", first_seen_at: date.toISOString() }],
        trends: {
          candidates: [
            {
              term: "studied",
              trend_filter: {
                benchmark: "hex picker",
                curve: [
                  [1, 2, 3],
                  [2, 3, 4],
                ],
              },
            },
          ],
          second_level: {
            deferred: [{ term }, { term }, { term: "hex picker" }],
          },
        },
      },
      date,
    ),
  );
  expect($(".trend-group img")).toHaveLength(0);
  expect($(".trend-group").text()).toContain(term);
  expect(new URL($(".trend-group").attr("href")!).searchParams.get("q")).toBe(
    `hex picker,${term}`,
  );
  expect($("meta[name=referrer]").attr("content")).toBe("no-referrer");
  const external = $("a[href^='https://']");
  expect(external.length).toBeGreaterThan(1);
  external.each((_, link) => {
    expect($(link).attr("referrerpolicy")).toBe("no-referrer");
    expect($(link).attr("rel")?.split(" ")).toEqual(
      expect.arrayContaining(["noopener", "noreferrer"]),
    );
  });
  expect(
    load(renderSite({ brief_terms: [] }, date))(".deferred-trends"),
  ).toHaveLength(0);
});

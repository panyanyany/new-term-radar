import { describe, expect, it, vi } from "vitest";
import { discoverRoots, requestFor, risingRows } from "../src/trends-roots.js";

describe("根词 Rising 契约", () => {
  it("三天使用自定义 UTC 日期，其他窗口使用接口预设", () => {
    expect(requestFor("game", 3, "2026-10-17")).toMatchObject({
      date_from: "2026-10-14",
      date_to: "2026-10-17",
      category_code: 8,
    });
    expect(requestFor("game", 1).time_range).toBe("past_day");
    expect(requestFor("game", 7).time_range).toBe("past_7_days");
  });
  it("拒绝 top 和无标签数组，只返回原始 rising 词组", () => {
    const wrap = (data: unknown) => ({
      status_code: 20000,
      tasks_error: 0,
      tasks: [
        {
          status_code: 20000,
          result: [{ items: [{ type: "google_trends_queries_list", data }] }],
        },
      ],
    });
    expect(() => risingRows(wrap({ top: [{ query: "the game" }] }))).toThrow(
      /rising/,
    );
    expect(() => risingRows(wrap([{ query: "the game" }]))).toThrow(/rising/);
    expect(
      risingRows(
        wrap({
          top: [{ query: "top" }],
          rising: [{ query: "full query phrase", value: 150 }],
        }),
      ).rows,
    ).toEqual([{ query: "full query phrase", value: 150 }]);
  });
});

vi.mock("../src/candidate-kind.js", () => ({
  classifyCandidates: vi.fn(async (rows) => ({
    candidates: rows,
    filtered: [],
  })),
}));
// 模拟曲线筛选已通过，确认类目生效且没有额外的 game 子串过滤。
vi.mock("../src/trends-filter.js", () => ({
  filterRootTrends: vi.fn(async (rows) => ({
    candidates: rows,
    filtered: [],
    cost_micros: 0,
  })),
}));
vi.mock("../src/aisa.js", () => ({ key: () => "test", call: vi.fn() }));
vi.mock("../src/scrappa.js", () => ({
  googleSearchResult: vi.fn(async () => ({
    evidence: [],
    rawResults: [],
    query: "test",
    costMicros: 303,
  })),
}));
vi.mock("../src/core.js", async (original) => ({
  ...(await original<typeof import("../src/core.js")>()),
  jsonFetch: vi.fn(async () => ({ results: [{ successful: true }] })),
}));
it("游戏类目 8 传给接口，所有原词进入搜索", async () => {
  const { call } = await import("../src/aisa.js");
  const { googleSearchResult } = await import("../src/scrappa.js");
  const { loadConfig } = await import("../src/core.js");
  const cfg = loadConfig("config.example.json");
  cfg.trends_roots = { roots: ["game"], windows: [1] };
  const response = (root: string) => ({
    root_0_1: {
      status_code: 20000,
      tasks_error: 0,
      tasks: [
        {
          status_code: 20000,
          result: [
            {
              check_url: `https://trends.google.com/trends/explore?cat=8&q=${root}&date=now%201-d`,
              items: [
                {
                  type: "google_trends_queries_list",
                  data: {
                    rising: [
                      { query: "Football GAME" },
                      { query: "games" },
                      { query: "gameplay" },
                      { query: "moonshot" },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  });
  vi.mocked(call).mockResolvedValue([response("game"), 11000]);
  const result = await discoverRoots(cfg);
  expect(
    vi.mocked(call).mock.calls[0][0][0].arguments.body[0].category_code,
  ).toBe(8);
  expect(result.candidates.map((r: { term: string }) => r.term)).toEqual([
    "Football GAME",
    "games",
    "gameplay",
    "moonshot",
  ]);
  expect(googleSearchResult).toHaveBeenCalledTimes(4);
  expect(googleSearchResult).toHaveBeenCalledWith("Football GAME", "broad");
  expect(googleSearchResult).toHaveBeenCalledWith("moonshot", "broad");
});
it("未通过曲线筛选的候选不触发搜索", async () => {
  const { filterRootTrends } = await import("../src/trends-filter.js");
  const { googleSearchResult } = await import("../src/scrappa.js");
  const { loadConfig } = await import("../src/core.js");
  vi.mocked(googleSearchResult).mockClear();
  vi.mocked(filterRootTrends).mockResolvedValueOnce({
    candidates: [],
    filtered: [{ term: "games", trend_filter: { status: "excluded" } }],
    cost_micros: 303,
  });
  const cfg = loadConfig("config.example.json");
  cfg.trends_roots = { roots: ["game"], windows: [1] };
  const result = await discoverRoots(cfg);
  expect(result.candidates).toEqual([]);
  expect(result.filtered).toHaveLength(1);
  expect(googleSearchResult).not.toHaveBeenCalled();
  expect(result.cost_micros).toBe(11303);
});

it("分类未确认的词不进入日报候选", async () => {
  const { classifyCandidates } = await import("../src/candidate-kind.js");
  const { loadConfig } = await import("../src/core.js");
  vi.mocked(classifyCandidates).mockResolvedValueOnce({
    candidates: [],
    filtered: [{ term: "games", classification: { status: "pending" } }],
  });
  const cfg = loadConfig("config.example.json");
  cfg.trends_roots = { roots: ["game"], windows: [1] };
  const result = await discoverRoots(cfg);
  expect(result.candidates).toEqual([]);
  expect(result.classification_filtered).toHaveLength(1);
});
